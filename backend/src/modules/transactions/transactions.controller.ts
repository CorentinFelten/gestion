import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { HouseholdMemberGuard } from '../../common/guards/household-member.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TransactionsService } from './transactions.service';
import {
  attachmentMulterOptions,
  type UploadedFileLike,
} from './attachment-upload';
import {
  CreateTransactionSchema,
  TransactionFilterSchema,
  UpdateTransactionSchema,
  type CreateTransactionDto,
  type TransactionFilter,
  type UpdateTransactionDto,
} from './dto/transaction.dto';

/** Household-scoped list/create (PLAN.md §6). */
@Controller('households/:householdId/transactions')
@UseGuards(AuthGuard, HouseholdMemberGuard)
export class HouseholdTransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  async list(
    @Param('householdId') householdId: string,
    @Query(new ZodValidationPipe(TransactionFilterSchema)) filter: TransactionFilter,
  ) {
    return this.transactions.list(householdId, filter);
  }

  @Post()
  @UseGuards(CsrfGuard)
  async create(
    @Param('householdId') householdId: string,
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(CreateTransactionSchema)) body: CreateTransactionDto,
  ) {
    return this.transactions.create(householdId, userId, body);
  }
}

/** Resource-scoped read/update/delete + attachments (PLAN.md §6). */
@Controller('transactions')
@UseGuards(AuthGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get(':id')
  async getOne(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.transactions.getById(id, userId);
  }

  @Patch(':id')
  @UseGuards(CsrfGuard)
  async update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(UpdateTransactionSchema)) body: UpdateTransactionDto,
  ) {
    return this.transactions.update(id, userId, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(CsrfGuard)
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    await this.transactions.remove(id, userId);
  }

  // POST /transactions/:id/attachments
  // SEC-10: FileInterceptor enforces the MIME allowlist (UPLOAD_ALLOWED_MIME),
  // size cap (UPLOAD_MAX_BYTES), a randomized on-disk filename and storage under
  // UPLOAD_DIR. The client `originalname` is never used to build the path.
  @Post(':id/attachments')
  @UseGuards(CsrfGuard)
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions()))
  async addAttachment(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    return this.transactions.addAttachment(id, userId, {
      originalname: file?.originalname ?? '',
      mimetype: file?.mimetype ?? '',
      size: file?.size ?? 0,
      path: file?.path ?? '',
    });
  }
}
