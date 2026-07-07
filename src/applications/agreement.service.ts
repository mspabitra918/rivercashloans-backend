import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as path from 'path';
import * as fs from 'fs';
import { Application } from './models/application.model';
import { UploadService } from '../upload/upload.service';
// Fixed APR from the product brief (see frontend src/lib/constants.ts LOAN.apr).
const APR_PERCENT = 10;

// LETTER page geometry (PDFKit points). margin keeps content inside 50pt gutters.
const PAGE_MARGIN = 75;
const PAGE_WIDTH = 612;
const CONTENT_LEFT = PAGE_MARGIN;
const CONTENT_RIGHT = PAGE_WIDTH - PAGE_MARGIN;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;

export const APP_TIME_ZONE = 'America/Los_Angeles';

/** Long date in Pacific time, e.g. "May 27, 2026". */
export function formatPacificLongDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: APP_TIME_ZONE,
  });
}

/** Date + time in Pacific time, e.g. "May 27, 2026, 2:14 PM PDT". */
export function formatPacificDateTime(d: Date): string {
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: APP_TIME_ZONE,
    timeZoneName: 'short',
  });
}

// Palette mirrored from the River Cash Loan_Agreement_Template.pdf.
const COLORS = {
  gold: '#C8911B',
  dark: '#0F172A',
  heading: '#111827',
  body: '#334155',
  muted: '#64748B',
  label: '#475569',
  rule: '#E2E8F0',
  tableHeaderBg: '#F8FAFC',
};

function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Number(amount) || 0);
}

function formatLongDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: APP_TIME_ZONE,
  });
}

// Options that turn the review copy into the executed (signed) copy.
export interface AgreementRenderOptions {
  signed?: boolean;
  signedName?: string | null;
  signedAt?: Date | null;
  accountLastFour?: string | null;
}

@Injectable()
export class AgreementService {
  private readonly logger = new Logger(AgreementService.name);

  constructor(private readonly upload: UploadService) {}

  // Render the loan agreement PDF into an in-memory buffer, faithfully matching
  // the rivercash_Loans_Loan_Agreement_Template.pdf layout (3 pages). When opts.signed
  // is set, the borrower signature block is stamped with the e-signature + date;
  // otherwise it shows the blank review copy.
  private renderPdf(
    application: Application,
    opts: AgreementRenderOptions = {},
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'LETTER',
          margin: PAGE_MARGIN,
          autoFirstPage: true,
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const signaturePath = path.join(process.cwd(), 'sign.png');

        const borrowerFirst = application.user?.firstName || '';
        const borrowerLast = application.user?.lastName || '';
        const borrowerName = `${borrowerFirst} ${borrowerLast}`.trim();

        const amount = Number(application.requestedAmount) || 0;
        const termMonths = Number(application.loanTermMonths) || 0;
        const monthlyRate = APR_PERCENT / 100 / 12;
        const monthlyPayment =
          monthlyRate > 0 && termMonths > 0
            ? (amount * monthlyRate) /
              (1 - Math.pow(1 + monthlyRate, -termMonths))
            : termMonths > 0
              ? amount / termMonths
              : 0;

        const agreementDate = formatLongDate(
          opts.signedAt ?? application.createdAt ?? new Date(),
        );
        const signDate = formatLongDate(opts.signedAt ?? new Date());
        const firstPaymentDate = new Date(opts.signedAt ?? new Date());
        firstPaymentDate.setMonth(firstPaymentDate.getMonth() + 1);

        // The account tail is decrypted by the caller (which owns the crypto
        // service) and passed through opts, so this renderer stays free of PII
        // handling and dependency wiring.
        const accountLastFour = opts.accountLastFour || '';

        // ── shared drawing helpers ──────────────────────────────────────────

        const sectionHeading = (text: string) => {
          doc.moveDown(1.2);
          doc.font('Helvetica-Bold').fontSize(11.5).fillColor(COLORS.heading);
          doc.text(text.toUpperCase(), CONTENT_LEFT, doc.y, {
            width: CONTENT_WIDTH,
          });
          doc.moveDown(1);
        };

        const bodyText = (text: string) => {
          doc.font('Helvetica').fontSize(11).fillColor(COLORS.body);
          doc.text(text, CONTENT_LEFT, doc.y, {
            width: CONTENT_WIDTH,
            align: 'justify',
            lineGap: 2,
          });
          doc.moveDown(1);
        };

        const pageFooter = (page: number) => {
          // Writing below the bottom margin would make PDFKit auto-insert a new
          // page. Temporarily drop the bottom margin so the footer stays on the
          // current page.
          const prevBottom = doc.page.margins.bottom;
          doc.page.margins.bottom = 0;
          doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
          doc.text(`Page ${page} of 3`, CONTENT_LEFT, doc.page.height - 40, {
            width: CONTENT_WIDTH,
            align: 'right',
            lineBreak: false,
          });
          doc.page.margins.bottom = prevBottom;
        };

        // Header block reused on page 1 only (matches the template masthead).
        const header = () => {
          const topY = PAGE_MARGIN;
          doc.font('Helvetica-Bold').fontSize(24);
          // Two-tone wordmark: "River Cash Loans" gold + " Lending" dark.
          doc
            .fillColor(COLORS.gold)
            .text('River Cash Loans', CONTENT_LEFT, topY, {
              continued: true,
            });
          doc.fillColor(COLORS.dark).text(' Lending');

          doc
            .font('Helvetica')
            .fontSize(9.5)
            .fillColor(COLORS.muted)
            .text(
              '355 S Grand Ave, Office #20 W, Los Angeles, CA 90071 | support@rivercashloans.com',
              CONTENT_LEFT,
              doc.y + 4,
              { width: CONTENT_WIDTH },
            );

          const ruleY = doc.y + 8;
          doc
            .moveTo(CONTENT_LEFT, ruleY)
            .lineTo(CONTENT_RIGHT, ruleY)
            .lineWidth(1)
            .strokeColor(COLORS.rule)
            .stroke();
          doc.y = ruleY + 16;
        };

        // Bordered two-column info table (label | value) like the template.
        const infoTable = (rows: Array<[string, string]>) => {
          const labelW = 150;
          const valueX = CONTENT_LEFT + labelW;
          const valueW = CONTENT_WIDTH - labelW - 24;
          const padX = 12;
          const padY = 9;

          rows.forEach(([label, value]) => {
            const startY = doc.y;
            doc.font('Helvetica').fontSize(10);
            const valueText = value || '-';
            const valueH = doc.heightOfString(valueText, { width: valueW });
            const rowH = Math.max(valueH + padY * 2, 30);

            // label cell background
            doc
              .rect(CONTENT_LEFT, startY, labelW, rowH)
              .fillColor(COLORS.tableHeaderBg)
              .fill();

            // borders
            doc
              .rect(CONTENT_LEFT, startY, CONTENT_WIDTH, rowH)
              .lineWidth(0.8)
              .strokeColor(COLORS.rule)
              .stroke();
            doc
              .moveTo(valueX, startY)
              .lineTo(valueX, startY + rowH)
              .strokeColor(COLORS.rule)
              .stroke();

            doc
              .font('Helvetica-Bold')
              .fontSize(9.5)
              .fillColor(COLORS.label)
              .text(label.toUpperCase(), CONTENT_LEFT + padX, startY + padY, {
                width: labelW - padX * 2,
              });

            doc
              .font('Helvetica')
              .fontSize(10)
              .fillColor(COLORS.heading)
              .text(valueText, valueX + padX, startY + padY, {
                width: valueW,
              });

            doc.y = startY + rowH;
          });
        };

        // ── PAGE 1 ──────────────────────────────────────────────────────────
        header();

        doc.y += 20;
        doc
          .font('Helvetica-Bold')
          .fontSize(16)
          .fillColor(COLORS.heading)
          .text('UNSECURED PERSONAL LOAN AGREEMENT', CONTENT_LEFT, doc.y, {
            width: CONTENT_WIDTH,
            align: 'center',
          });

        doc.moveDown(1.2);

        doc
          .font('Helvetica')
          .fontSize(10.5)
          .fillColor(COLORS.body)
          .text(
            `This Personal Loan Agreement (the "Agreement") is entered into as of ${agreementDate}, by and between River Cash Loans ("Lender") and the individual identified below ("Borrower").`,
            CONTENT_LEFT,
            doc.y,
            { width: CONTENT_WIDTH, align: 'justify', lineGap: 4 },
          );

        doc.moveDown(0.8);

        const addressLine = [
          application.user?.address,
          application.user?.city,
          `${application.user?.state || ''} ${application?.user?.zipCode || ''}`.trim(),
        ]
          .filter(Boolean)
          .join(', ');

        infoTable([
          ['Application ID', application.id],
          ['Borrower Name', borrowerName],
          ['Borrower Address', addressLine],
          ['Borrower Email', application.user?.email ?? ''],
        ]);

        sectionHeading('1. Loan Amount and Interest Rate');
        // bodyText(`Principal Amount: ${formatUSD(amount)} (the "Loan").`);
        // doc.moveDown(0.2);
        // bodyText(
        //   `Interest Rate: ${APR_PERCENT}% Fixed Annual Percentage Rate (APR).`,
        // );
        // doc.moveDown(0.2);
        // bodyText(
        //   "Interest will begin to accrue on the date the Principal Amount is disbursed to the Borrower's designated bank account. The APR is fixed for the life of the loan and will not increase.",
        // );

        const loanBullets: Array<[string, string]> = [
          ['Principal Amount', `${formatUSD(amount)} (the "Loan").`],
          [
            'Interest Rate',
            ` ${APR_PERCENT}% Fixed Annual Percentage Rate (APR).`,
          ],
        ];
        loanBullets.forEach(([label, value]) => {
          const y = doc.y;
          doc.font('Helvetica-Bold').fontSize(12.5).fillColor(COLORS.body);
          doc.text(`•  ${label}: `, CONTENT_LEFT + 16, y, { continued: true });
          doc.font('Helvetica').fillColor(COLORS.heading).text(value);
          doc.moveDown(1);
        });
        bodyText(
          "Interest will begin to accrue on the date the Principal Amount is disbursed to the Borrower's designated bank account. The APR is fixed for the life of the loan and will not increase.",
        );

        sectionHeading('2. Promise to Pay');
        bodyText(
          'For value received, the Borrower promises to pay to the order of the Lender the Principal Amount plus accrued interest at the fixed rate outlined in Section 1, according to the repayment schedule outlined in Section 3 of this Agreement.',
        );

        pageFooter(1);

        // ── PAGE 2 ──────────────────────────────────────────────────────────
        doc.addPage();

        sectionHeading('3. Repayment Terms');
        bodyText(
          'The Borrower agrees to repay the Loan in consecutive monthly installments.',
        );
        doc.moveDown(0.4);

        const bullets: Array<[string, string]> = [
          ['Term', `${termMonths} months`],
          ['Monthly Payment Amount', formatUSD(monthlyPayment)],
          ['First Payment Date', formatLongDate(firstPaymentDate)],
        ];
        bullets.forEach(([label, value]) => {
          const y = doc.y;
          doc.font('Helvetica-Bold').fontSize(11.6).fillColor(COLORS.body);
          doc.text(`•  ${label}: `, CONTENT_LEFT + 16, y, { continued: true });
          doc.font('Helvetica').fillColor(COLORS.heading).text(value);
          doc.moveDown(0.6);
        });

        doc.moveDown(0.3);
        bodyText(
          `Payments will be processed via automatic ACH deduction from the Borrower's verified bank account on file${
            accountLastFour ? ` (Account ending in ${accountLastFour})` : ''
          }.`,
        );

        sectionHeading('4. Unsecured Loan');
        bodyText(
          'This Agreement is for an unsecured personal loan. The Lender does not require, and the Borrower has not provided, any collateral to secure this Loan. No upfront fees or application fees have been charged to the Borrower.',
        );

        sectionHeading('5. Prepayment');
        bodyText(
          'The Borrower has the right to prepay the outstanding principal balance of this Loan, in whole or in part, at any time without penalty or additional fees. Any partial prepayment will be applied first to accrued interest, and then to the principal balance.',
        );

        sectionHeading('6. Default');
        bodyText(
          'The Borrower will be in default under this Agreement if they fail to make any required payment by the due date. Upon default, the Lender may declare the entire unpaid principal balance, plus any accrued interest and applicable fees, immediately due and payable, subject to any right to cure required by applicable state and federal laws.',
        );

        sectionHeading('7. Governing Law');
        bodyText(
          'This Agreement shall be governed by and construed in accordance with the laws of the State of California, and applicable federal laws of the United States, without regard to conflict of law principles.',
        );

        pageFooter(2);

        // ── PAGE 3 (signatures) ─────────────────────────────────────────────
        doc.addPage();

        const colGap = 30;
        const colW = (CONTENT_WIDTH - colGap) / 2;
        const leftX = CONTENT_LEFT;
        const rightX = CONTENT_LEFT + colW + colGap;
        const topY = PAGE_MARGIN + 10;

        // Column headings
        doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.heading);
        doc.text('BORROWER', leftX, topY, { width: colW });
        doc.text('LENDER', rightX, topY, { width: colW });

        const introY = topY + 22;
        doc.font('Helvetica').fontSize(10).fillColor(COLORS.body);
        doc.text(
          'I acknowledge that I have read, understood, and agreed to the terms and conditions of this Unsecured Personal Loan Agreement via electronic signature.',
          leftX,
          introY,
          { width: colW, lineGap: 2 },
        );
        doc.text(
          'Authorized Representative for River Cash Loans.',
          rightX,
          introY,
          { width: colW, lineGap: 2 },
        );

        // Signature lines + stamps
        const sigLineY = introY + 90;

        // Borrower signature
        doc
          .moveTo(leftX, sigLineY)
          .lineTo(leftX + colW, sigLineY)
          .lineWidth(0.8)
          .strokeColor(COLORS.muted)
          .stroke();
        doc
          .font('Helvetica-Bold')
          .fontSize(9.5)
          .fillColor(COLORS.label)
          .text('Signature:', leftX, sigLineY + 6);
        if (opts.signed && (opts.signedName || borrowerName)) {
          // Stylised e-signature stamp (cursive-like) of the typed legal name.
          doc
            .font('Helvetica-Oblique')
            .fontSize(18)
            .fillColor(COLORS.dark)
            .text(opts.signedName || borrowerName, leftX, sigLineY + 18, {
              width: colW,
            });
        }

        // Lender signature image (optional — skip gracefully if the asset is
        // not deployed so a missing file never aborts PDF generation).
        if (fs.existsSync(signaturePath)) {
          doc.image(signaturePath, rightX, sigLineY - 40, {
            width: 150,
            height: 40,
          });
        }

        // Signature line
        doc
          .moveTo(rightX, sigLineY)
          .lineTo(rightX + colW, sigLineY)
          .lineWidth(0.8)
          .strokeColor(COLORS.muted)
          .stroke();

        // Signature text
        doc
          .font('Helvetica-Bold')
          .fontSize(9.5)
          .fillColor(COLORS.heading)
          .text('Signature: River Cash Loans Admin', rightX, sigLineY + 6, {
            width: colW,
          });

        // Date lines
        const dateLineY = sigLineY + 70;
        doc
          .moveTo(leftX, dateLineY)
          .lineTo(leftX + colW * 0.7, dateLineY)
          .strokeColor(COLORS.muted)
          .stroke();
        doc
          .moveTo(rightX, dateLineY)
          .lineTo(rightX + colW * 0.7, dateLineY)
          .strokeColor(COLORS.muted)
          .stroke();

        doc
          .font('Helvetica-Bold')
          .fontSize(9.5)
          .fillColor(COLORS.label)
          .text('Date:', leftX, dateLineY + 6);
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(COLORS.heading)
          .text(opts.signed ? signDate : '', leftX, dateLineY + 18, {
            width: colW,
          });

        doc
          .font('Helvetica-Bold')
          .fontSize(9.5)
          .fillColor(COLORS.label)
          .text('Date:', rightX, dateLineY + 6);
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(COLORS.heading)
          .text(opts.signed ? signDate : '', rightX, dateLineY + 18, {
            width: colW,
          });

        // Footer disclaimer + rule
        const discRuleY = dateLineY + 70;
        doc
          .moveTo(CONTENT_LEFT, discRuleY)
          .lineTo(CONTENT_RIGHT, discRuleY)
          .lineWidth(0.8)
          .strokeColor(COLORS.rule)
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(COLORS.muted)
          .text(
            'This document is a system-generated template. Executed agreements are legally binding subject to the E-Sign Act.',
            CONTENT_LEFT,
            discRuleY + 10,
            { width: CONTENT_WIDTH, align: 'center' },
          );

        pageFooter(3);

        doc.end();
      } catch (error) {
        this.logger.error(
          'Failed to render loan agreement PDF',
          error as Error,
        );
        reject(error as Error);
      }
    });
  }

  // Generate the (unsigned) review agreement PDF for an application and store
  // it. Returns the storage object key. Callers persist the key on the record.
  async generateAndStore(
    application: Application,
    opts: AgreementRenderOptions = {},
  ): Promise<string> {
    const pdf = await this.renderPdf(application, opts);
    const key = await this.upload.saveBuffer(pdf, '.pdf', 'application/pdf');
    this.logger.log(
      `Generated loan agreement for ${application.id} → ${key}` +
        (opts.signed ? ' (signed)' : ''),
    );
    return key;
  }

  // Render the executed (signed) agreement PDF in-memory. Used both to store
  // the signed copy and to attach it to the borrower's confirmation email.
  async renderSignedPdf(
    application: Application,
    opts: Omit<AgreementRenderOptions, 'signed'>,
  ): Promise<Buffer> {
    return this.renderPdf(application, { ...opts, signed: true });
  }
}
