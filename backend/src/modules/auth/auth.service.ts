import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from './session.service';
import type { AuthResultDto, AuthUserDto, LoginDto, RegisterDto } from './dto/auth.dto';

/**
 * OWASP-recommended argon2id parameters (memory-hard, side-channel resistant).
 * ~19 MiB, 2 iterations, single lane, a good self-hosted default.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

// A pre-computed hash used to normalize timing when an email is unknown, so a
// failed login costs roughly the same whether or not the account exists.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$7xCpyXz+JPgrUCmByF1omA$tKO2oVO9N49CMvNAmKU6Lqmv2KAh1kmzhh/U36Fl6A4';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  private toAuthUser(user: User): AuthUserDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      preferredCurrency: user.preferredCurrency,
      pinnedCurrencies: user.pinnedCurrencies,
      locale: user.locale,
    };
  }

  async register(dto: RegisterDto, meta?: { userAgent?: string; ip?: string }): Promise<AuthResultDto> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName: dto.displayName,
        preferredCurrency: dto.preferredCurrency ?? 'EUR',
        locale: dto.locale ?? 'fr-FR',
      },
    });

    const session = await this.sessions.create(user.id, meta);
    return {
      user: this.toAuthUser(user),
      sessionId: session.id,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  async login(dto: LoginDto, meta?: { userAgent?: string; ip?: string }): Promise<AuthResultDto> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always run a verify to keep timing uniform and avoid user enumeration.
    const hashToCheck = user?.passwordHash ?? DUMMY_HASH;
    let passwordOk = false;
    try {
      passwordOk = await argon2.verify(hashToCheck, dto.password);
    } catch {
      passwordOk = false;
    }

    if (!user || !passwordOk) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    // Rotation: mint a brand-new session on every successful login.
    const session = await this.sessions.create(user.id, meta);
    return {
      user: this.toAuthUser(user),
      sessionId: session.id,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  async me(userId: string): Promise<AuthUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toAuthUser(user);
  }
}
