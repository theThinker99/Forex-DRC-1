import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AttachmentKind, Role } from '@prisma/client';
import { Response } from 'express';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { AttachmentsService, MAX_FILE_BYTES } from './attachments.service';

class UploadAttachmentDto {
  @ApiPropertyOptional({ description: 'Client auquel rattacher le document.' })
  @IsUUID('4')
  @IsOptional()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Operation a laquelle rattacher le document.' })
  @IsUUID('4')
  @IsOptional()
  transactionId?: string;

  @ApiProperty({ enum: AttachmentKind, default: AttachmentKind.PIECE_IDENTITE })
  @IsEnum(AttachmentKind, { message: 'Type de document invalide.' })
  kind!: AttachmentKind;
}

@ApiTags('Pieces jointes')
@ApiBearerAuth('access-token')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @Roles(Role.CABISTE, Role.SUPERVISEUR, Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      // Stockage memoire : le fichier doit etre inspecte (signature binaire)
      // avant d'atterrir ou que ce soit sur le disque.
      limits: { fileSize: MAX_FILE_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'kind'],
      properties: {
        file: { type: 'string', format: 'binary' },
        kind: { type: 'string', enum: Object.values(AttachmentKind) },
        clientId: { type: 'string', format: 'uuid' },
        transactionId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiOperation({
    summary: 'Televerser un document (photo de piece d\'identite, justificatif)',
    description: 'JPEG, PNG, WebP ou PDF. 5 Mo maximum. Le type reel est verifie.',
  })
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAttachmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attachments.upload(file, dto, user);
  }

  @Get('client/:clientId')
  @ApiOperation({ summary: 'Documents d\'un client' })
  listForClient(
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attachments.listForClient(clientId, user);
  }

  @Get(':id/content')
  @ApiOperation({
    summary: 'Telecharger un document',
    description: 'Seul point d\'acces au binaire : soumis au RBAC et journalise.',
  })
  async download(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, mimeType, filename } = await this.attachments.download(id, user);

    res.setHeader('Content-Type', mimeType);
    // `inline` pour l'affichage dans la fiche client ; le nom est entre
    // guillemets car il peut contenir des espaces.
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    // Un document d'identite n'a rien a faire dans un cache partage.
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buffer);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Supprimer un document',
    description:
      'Reservee a l\'administrateur. Le binaire est efface du stockage ; ' +
      'l\'audit conserve la trace de la suppression.',
  })
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attachments.remove(id, user);
  }
}
