import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { ReceiptsService } from './receipts.service';

@ApiTags('Bordereaux')
@ApiBearerAuth('access-token')
@Controller('transactions/:transactionId/receipt')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  @ApiOperation({ summary: 'Metadonnees du bordereau (numero, nombre d\'impressions)' })
  metadata(
    @Param('transactionId', new ParseUUIDPipe({ version: '4' })) transactionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.receipts.metadata(transactionId, user);
  }

  /**
   * POST plutot que GET : la generation incremente le compteur d'impressions,
   * ce n'est donc pas une lecture sans effet. Ce choix ferme aussi la route a
   * la BCC, dont le mandat lecture seule est applique par le ReadOnlyGuard.
   */
  @Post('pdf')
  @Roles(Role.CABISTE, Role.SUPERVISEUR, Role.ADMIN)
  @ApiOperation({
    summary: 'Generer / imprimer le bordereau PDF',
    description:
      'Renvoie le PDF. Toute generation apres la premiere est marquee DUPLICATA ' +
      'et comptabilisee, pour que les reimpressions anormales restent visibles.',
  })
  async pdf(
    @Param('transactionId', new ParseUUIDPipe({ version: '4' })) transactionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.receipts.render(transactionId, user);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buffer);
  }
}
