export type ParsedInvoiceRow = {
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  invoiceNumber: string;
  amount: number;
  issuedAt: string;
  dueAt: string;
  paymentLink?: string;
  notes?: string;
};

export type CsvParseResult = {
  rows: ParsedInvoiceRow[];
  errors: string[];
};

export const CSV_TEMPLATE = `client_name,client_email,client_phone,invoice_number,amount,issued_at,due_at,payment_link,notes
Acme Corp,accounts@acme.com,+1 555 010 0200,INV-1001,1500.00,2026-01-15,2026-02-15,https://pay.example.com/inv1001,
Northline Studio,finance@northline.io,+44 20 7946 0958,INV-1002,2800,2026-02-01,2026-03-01,,
`;

export const CSV_MAX_ROWS = 500;

const HEADER_ALIASES: Record<string, keyof ParsedInvoiceRow | 'skip'> = {
  client_name: 'clientName',
  clientname: 'clientName',
  client: 'clientName',
  name: 'clientName',
  customer: 'clientName',
  customer_name: 'clientName',
  client_email: 'clientEmail',
  clientemail: 'clientEmail',
  email: 'clientEmail',
  client_phone: 'clientPhone',
  clientphone: 'clientPhone',
  phone: 'clientPhone',
  mobile: 'clientPhone',
  whatsapp: 'clientPhone',
  tel: 'clientPhone',
  invoice_number: 'invoiceNumber',
  invoicenumber: 'invoiceNumber',
  invoice: 'invoiceNumber',
  invoice_no: 'invoiceNumber',
  invoice_id: 'invoiceNumber',
  inv: 'invoiceNumber',
  amount: 'amount',
  total: 'amount',
  invoice_amount: 'amount',
  value: 'amount',
  issued_at: 'issuedAt',
  issuedat: 'issuedAt',
  issue_date: 'issuedAt',
  issued: 'issuedAt',
  invoice_date: 'issuedAt',
  date_issued: 'issuedAt',
  due_at: 'dueAt',
  dueat: 'dueAt',
  due_date: 'dueAt',
  due: 'dueAt',
  payment_link: 'paymentLink',
  paymentlink: 'paymentLink',
  pay_link: 'paymentLink',
  payment_url: 'paymentLink',
  link: 'paymentLink',
  notes: 'notes',
  note: 'notes',
  comments: 'notes',
};

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s#]+/g, '_').replace(/_+/g, '_');
}

/** Parse a single CSV line respecting quoted fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCsvText(text: string): string[][] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  return lines.map(parseCsvLine);
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '').replace(/[^\d.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDateField(raw: string, fieldName: string, lineNum: number, errors: string[]): string | null {
  const v = raw.trim();
  if (!v) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  errors.push(`Line ${lineNum}: invalid ${fieldName} "${raw}" (use YYYY-MM-DD)`);
  return null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function downloadCsvTemplate(): void {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'collectquiet-invoice-import-template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function parseInvoiceCsv(
  text: string,
  existingInvoiceNumbers: Set<string> = new Set()
): CsvParseResult {
  const errors: string[] = [];
  const rows: ParsedInvoiceRow[] = [];
  const grid = parseCsvText(text);

  if (grid.length < 2) {
    return { rows: [], errors: ['CSV must include a header row and at least one data row.'] };
  }

  const headerMap: Partial<Record<keyof ParsedInvoiceRow, number>> = {};
  grid[0].forEach((h, idx) => {
    const key = HEADER_ALIASES[normalizeHeader(h)];
    if (key && key !== 'skip') headerMap[key] = idx;
  });

  const required: (keyof ParsedInvoiceRow)[] = ['clientName', 'clientEmail', 'invoiceNumber', 'amount', 'dueAt'];
  for (const req of required) {
    if (headerMap[req] === undefined) {
      errors.push(`Missing required column: ${req.replace(/([A-Z])/g, '_$1').toLowerCase()}`);
    }
  }
  if (errors.length) return { rows, errors };

  const dataLines = grid.slice(1);
  if (dataLines.length > CSV_MAX_ROWS) {
    errors.push(`Too many rows (${dataLines.length}). Maximum is ${CSV_MAX_ROWS} per import.`);
    return { rows, errors };
  }

  const seenInFile = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);

  dataLines.forEach((cols, i) => {
    const lineNum = i + 2;
    const get = (key: keyof ParsedInvoiceRow) => {
      const idx = headerMap[key];
      return idx === undefined ? '' : (cols[idx] ?? '').trim();
    };

    if (cols.every((c) => !c.trim())) return;

    const clientName = get('clientName');
    const clientEmail = get('clientEmail');
    const invoiceNumber = get('invoiceNumber');
    const amountRaw = get('amount');
    const dueRaw = get('dueAt');

    if (!clientName) errors.push(`Line ${lineNum}: client name is required.`);
    if (!clientEmail) errors.push(`Line ${lineNum}: client email is required.`);
    else if (!isValidEmail(clientEmail)) errors.push(`Line ${lineNum}: invalid email "${clientEmail}".`);

    if (!invoiceNumber) errors.push(`Line ${lineNum}: invoice number is required.`);
    else if (seenInFile.has(invoiceNumber)) errors.push(`Line ${lineNum}: duplicate invoice # "${invoiceNumber}" in file.`);
    else if (existingInvoiceNumbers.has(invoiceNumber)) errors.push(`Line ${lineNum}: invoice # "${invoiceNumber}" already exists in your account.`);
    else seenInFile.add(invoiceNumber);

    const amount = parseAmount(amountRaw);
    if (!amountRaw) errors.push(`Line ${lineNum}: amount is required.`);
    else if (amount === null) errors.push(`Line ${lineNum}: invalid amount "${amountRaw}".`);

    const dueAt = parseDateField(dueRaw, 'due date', lineNum, errors);
    if (!dueRaw) errors.push(`Line ${lineNum}: due date is required.`);

    const issuedRaw = get('issuedAt');
    const issuedAt = issuedRaw ? parseDateField(issuedRaw, 'issue date', lineNum, errors) ?? today : today;

    if (!clientName || !clientEmail || !invoiceNumber || amount === null || !dueAt) return;
    if (dueAt < issuedAt) errors.push(`Line ${lineNum}: due date must be on or after issue date.`);

    const phone = get('clientPhone');
    const paymentLink = get('paymentLink');
    const notes = get('notes');

    rows.push({
      clientName,
      clientEmail,
      clientPhone: phone || undefined,
      invoiceNumber,
      amount,
      issuedAt,
      dueAt,
      paymentLink: paymentLink || undefined,
      notes: notes || undefined,
    });
  });

  if (!rows.length && !errors.length) {
    errors.push('No data rows found in CSV.');
  }

  return { rows, errors };
}
