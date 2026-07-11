import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateProfileDto } from './dto/user.dto';

export type { UpdateProfileDto } from './dto/user.dto';

export interface PublicUserDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface UserProfileDto extends PublicUserDto {
  email: string;
  preferredCurrency: string;
  pinnedCurrencies: string[];
  locale: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Minimal public profile, only returned when the target user shares a
   * household with the caller. Non-co-members get a 404 (indistinguishable
   * from a non-existent id) so member existence can't be probed cross-household.
   */
  async getPublicProfile(callerId: string, userId: string): Promise<PublicUserDto> {
    // A caller may always resolve their own profile.
    if (userId !== callerId) {
      const shared = await this.prisma.householdMember.findFirst({
        where: {
          userId,
          household: { members: { some: { userId: callerId } } },
        },
        select: { userId: true },
      });
      if (!shared) {
        throw new NotFoundException('User not found');
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, avatarUrl: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        email: true,
        preferredCurrency: true,
        pinnedCurrencies: true,
        locale: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserProfileDto> {
    // Ensure the user exists first (update on missing id would throw P2025).
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) {
      throw new NotFoundException('User not found');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
        ...(dto.preferredCurrency !== undefined ? { preferredCurrency: dto.preferredCurrency } : {}),
        ...(dto.pinnedCurrencies !== undefined ? { pinnedCurrencies: dto.pinnedCurrencies } : {}),
        ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
      },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        email: true,
        preferredCurrency: true,
        pinnedCurrencies: true,
        locale: true,
      },
    });
    return user;
  }
}
