import { Injectable } from '@nestjs/common';
import { Currency, TransactionType } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { formatAmount, formatRate } from '../common/utils/money';

export interface ReceiptData {
  number: string;
  reference: string;
  type: TransactionType;
  issuedAt: Date;
  occurredAt: Date;
  agency: {
    code: string;
    name: string;
    city: string;
    address: string | null;
    phone: string | null;
    licenseNo: string | null;
  };
  operator: { fullName: string };
  client: {
    fullName: string;
    idDocumentType: string;
    idDocumentNo: string;
    phone: string | null;
  };
  fromCurrency: Currency;
  fromAmount: string;
  toCurrency: Currency;
  toAmount: string;
  appliedRate: string;
  commission: string;
  checksum: string;
  reprint: boolean;
  printCount: number;
}

// Charte sobre, adaptee au domaine bancaire : bleu nuit et ardoise, aucun
// degrade "IA", contraste eleve pour rester lisible sur une imprimante
// thermique ou une photocopie.
const COLORS = {
  primary: '#0f3d5c',
  accent: '#0e7490',
  ink: '#1e293b',
  muted: '#64748b',
  hairline: '#cbd5e1',
  zebra: '#f1f5f9',
  danger: '#b91c1c',
};

const LABELS: Record<TransactionType, string> = {
  ACHAT: "ACHAT DE DEVISES (le bureau achete)",
  VENTE: "VENTE DE DEVISES (le bureau vend)",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  CARTE_ELECTEUR: "Carte d'electeur",
  PASSEPORT: 'Passeport',
  PERMIS_CONDUIRE: 'Permis de conduire',
  CARTE_SERVICE: 'Carte de service',
  CARTE_REFUGIE: 'Carte de refugie',
  AUTRE: 'Autre piece',
};

/**
 * Genere le bordereau PDF cote serveur avec pdfkit.
 *
 * pdfkit plutot qu'un rendu HTML->PDF (Puppeteer) : pas de Chromium a
 * telecharger ni a maintenir, empreinte memoire minime, sortie deterministe
 * — deux appels produisent des octets identiques, ce qui compte pour un
 * document dont on verifie le checksum.
 */
@Injectable()
export class ReceiptPdfService {
  generate(data: ReceiptData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A5',
          layout: 'portrait',
          margins: { top: 36, bottom: 40, left: 40, right: 40 },
          info: {
            Title: `Bordereau ${data.number}`,
            Author: data.agency.name,
            Subject: `Operation de change ${data.reference}`,
            Creator: 'Forex DRC',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.drawHeader(doc, data);
        this.drawReference(doc, data);
        this.drawParties(doc, data);
        this.drawOperation(doc, data);
        this.drawFooter(doc, data);

        doc.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private drawHeader(doc: PDFKit.PDFDocument, data: ReceiptData): void {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;

    doc
      .fillColor(COLORS.primary)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(data.agency.name.toUpperCase(), left, doc.y, { width: right - left });

    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
    const parts = [
      data.agency.address,
      data.agency.city,
      data.agency.phone ? `Tel. ${data.agency.phone}` : null,
    ].filter(Boolean);
    doc.text(parts.join(' • '), { width: right - left });
    if (data.agency.licenseNo) {
      doc.text(`Agrement BCC : ${data.agency.licenseNo}`, { width: right - left });
    }

    doc.moveDown(0.6);
    doc
      .fillColor(COLORS.ink)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('BORDEREAU DE CHANGE', left, doc.y, {
        width: right - left,
        align: 'center',
      });

    doc.moveDown(0.3);
    this.hairline(doc);
    doc.moveDown(0.5);
  }

  private drawReference(doc: PDFKit.PDFDocument, data: ReceiptData): void {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const startY = doc.y;
    const colWidth = (right - left) / 2;

    this.labelValue(doc, left, startY, colWidth, 'N° de bordereau', data.number, true);
    this.labelValue(
      doc,
      left + colWidth,
      startY,
      colWidth,
      'Reference operation',
      data.reference,
    );

    const secondY = doc.y + 4;
    this.labelValue(
      doc,
      left,
      secondY,
      colWidth,
      "Date et heure de l'operation",
      this.formatDateTime(data.occurredAt),
    );
    this.labelValue(
      doc,
      left + colWidth,
      secondY,
      colWidth,
      "Cabiste",
      data.operator.fullName,
    );

    doc.y = doc.y + 6;
    doc.moveDown(0.4);
  }

  private drawParties(doc: PDFKit.PDFDocument, data: ReceiptData): void {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;

    this.sectionTitle(doc, 'CLIENT');

    const startY = doc.y;
    const colWidth = (right - left) / 2;
    this.labelValue(doc, left, startY, colWidth, 'Nom complet', data.client.fullName);
    this.labelValue(
      doc,
      left + colWidth,
      startY,
      colWidth,
      'Piece',
      `${DOC_TYPE_LABELS[data.client.idDocumentType] ?? data.client.idDocumentType} — ${data.client.idDocumentNo}`,
    );

    if (data.client.phone) {
      const phoneY = doc.y + 2;
      this.labelValue(doc, left, phoneY, colWidth, 'Telephone', data.client.phone);
      doc.y = phoneY + 24;
    } else {
      doc.y += 4;
    }
    doc.moveDown(0.3);
  }

  private drawOperation(doc: PDFKit.PDFDocument, data: ReceiptData): void {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    this.sectionTitle(doc, "DETAIL DE L'OPERATION");

    // Bandeau du sens de l'operation.
    const badgeY = doc.y;
    doc
      .roundedRect(left, badgeY, width, 20, 3)
      .fill(COLORS.accent);
    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(LABELS[data.type], left, badgeY + 6, { width, align: 'center' });
    doc.y = badgeY + 28;

    const rows: Array<[string, string, boolean]> = [
      ['Montant remis par le client', formatAmount(data.fromAmount, data.fromCurrency), false],
      ['Taux applique', `1 ${this.baseCurrency(data)} = ${formatRate(data.appliedRate)} CDF`, false],
      ['Commission', formatAmount(data.commission, data.toCurrency), false],
      ['MONTANT REMIS AU CLIENT', formatAmount(data.toAmount, data.toCurrency), true],
    ];

    let y = doc.y;
    const rowHeight = 22;
    rows.forEach(([label, value, highlight], index) => {
      if (index % 2 === 0) {
        doc.rect(left, y, width, rowHeight).fill(COLORS.zebra);
      }
      doc
        .fillColor(highlight ? COLORS.primary : COLORS.ink)
        .font(highlight ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(highlight ? 11 : 9)
        .text(label, left + 8, y + (highlight ? 6 : 7), { width: width * 0.55 });
      doc
        .fillColor(highlight ? COLORS.primary : COLORS.ink)
        .font('Helvetica-Bold')
        .fontSize(highlight ? 12 : 9)
        .text(value, left + width * 0.55, y + (highlight ? 5 : 7), {
          width: width * 0.45 - 8,
          align: 'right',
        });
      y += rowHeight;
    });

    doc.y = y + 6;
  }

  private drawFooter(doc: PDFKit.PDFDocument, data: ReceiptData): void {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    doc.moveDown(0.5);
    this.hairline(doc);
    doc.moveDown(0.5);

    if (data.reprint) {
      doc
        .fillColor(COLORS.danger)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(
          `DUPLICATA — reimpression n°${data.printCount}`,
          left,
          doc.y,
          { width, align: 'center' },
        );
      doc.moveDown(0.4);
    }

    // Zones de signature.
    const signY = doc.y;
    const colWidth = width / 2;
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(8)
      .text('Signature du cabiste', left, signY, { width: colWidth - 10, align: 'center' })
      .text('Signature du client', left + colWidth + 10, signY, {
        width: colWidth - 10,
        align: 'center',
      });
    doc
      .strokeColor(COLORS.hairline)
      .lineWidth(0.5)
      .moveTo(left + 10, signY + 26)
      .lineTo(left + colWidth - 20, signY + 26)
      .moveTo(left + colWidth + 20, signY + 26)
      .lineTo(right - 10, signY + 26)
      .stroke();

    doc.y = signY + 36;

    // Empreinte d'integrite : permet de verifier qu'un duplicata correspond
    // bien a l'operation d'origine, sans stocker le PDF lui-meme.
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(6.5)
      .text(
        `Empreinte d'integrite (SHA-256) : ${data.checksum}`,
        left,
        doc.y,
        { width },
      );
    doc.text(
      `Bordereau emis le ${this.formatDateTime(data.issuedAt)} • Document genere par le systeme, valable sans cachet.`,
      { width },
    );
  }

  // --- Primitives de mise en page -------------------------------------------

  private baseCurrency(data: ReceiptData): Currency {
    // Le taux exprime toujours le prix de la devise etrangere : c'est celle
    // des deux qui n'est pas le CDF.
    return data.fromCurrency === Currency.CDF ? data.toCurrency : data.fromCurrency;
  }

  private sectionTitle(doc: PDFKit.PDFDocument, title: string): void {
    const left = doc.page.margins.left;
    doc
      .fillColor(COLORS.accent)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(title, left, doc.y, { characterSpacing: 1 });
    doc.moveDown(0.3);
  }

  private labelValue(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    label: string,
    value: string,
    emphasize = false,
  ): void {
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(7)
      .text(label.toUpperCase(), x, y, { width, characterSpacing: 0.5 });
    doc
      .fillColor(emphasize ? COLORS.primary : COLORS.ink)
      .font(emphasize ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(emphasize ? 11 : 9)
      .text(value, x, y + 9, { width });
  }

  private hairline(doc: PDFKit.PDFDocument): void {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    doc
      .strokeColor(COLORS.hairline)
      .lineWidth(0.75)
      .moveTo(left, doc.y)
      .lineTo(right, doc.y)
      .stroke();
  }

  private formatDateTime(date: Date): string {
    return date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
