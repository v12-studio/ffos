import { deflateRawSync } from 'node:zlib';

// A small Excel (.xlsx) writer: enough for exports (several sheets, a bold frozen header row with filters,
// column widths, money and date cells). Text is written as inline strings, so a note like "=SUM(A1)"
// stays text and is never run as a formula.

export type ColumnType = 'text' | 'money' | 'date' | 'number';

export interface SheetColumn {
  header: string;
  type?: ColumnType;
  /** In characters. */
  width?: number;
}

export interface SheetData {
  name: string;
  columns: SheetColumn[];
  /** Money cells take the amount in major units (rupees); date cells take YYYY-MM-DD. */
  rows: (string | number | null)[][];
}

// Style ids, matching the cellXfs list in styles.xml below.
const STYLE = { text: 0, header: 1, money: 2, date: 3, number: 4 } as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Characters XML 1.0 doesn't allow (control characters other than tab and newlines). */
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

function xmlText(value: string): string {
  return value.replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A, B, … Z, AA, AB … */
function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Excel's serial day number for a YYYY-MM-DD date (days since 30 Dec 1899). */
function dateSerial(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/** Sheet names: at most 31 characters, none of : \ / ? * [ ], and unique within the workbook. */
function sheetNames(sheets: SheetData[]): string[] {
  const used = new Set<string>();
  return sheets.map((s) => {
    const base = s.name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function cellXml(ref: string, value: string | number | null, type: ColumnType): string {
  if (value === null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const style = type === 'money' ? STYLE.money : type === 'date' ? STYLE.date : type === 'number' ? STYLE.number : STYLE.text;
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  const text = String(value);
  if (type === 'date') {
    const serial = dateSerial(text);
    if (serial !== null) return `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

function sheetXml(sheet: SheetData): string {
  const lastCol = columnLetter(Math.max(0, sheet.columns.length - 1));
  const lastRow = sheet.rows.length + 1;
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? Math.max(10, c.header.length + 2)}" customWidth="1"/>`)
    .join('');
  const header = `<row r="1">${sheet.columns
    .map((c, i) => `<c r="${columnLetter(i)}1" t="inlineStr" s="${STYLE.header}"><is><t xml:space="preserve">${xmlText(c.header)}</t></is></c>`)
    .join('')}</row>`;
  const body = sheet.rows
    .map((row, r) => `<row r="${r + 2}">${row.map((v, i) => cellXml(`${columnLetter(i)}${r + 2}`, v, sheet.columns[i]?.type ?? 'text')).join('')}</row>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="A1:${lastCol}${lastRow}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${header}${body}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${lastRow}"/>` +
    '</worksheet>'
  );
}

/** Builds an .xlsx workbook with one sheet per entry. */
export function buildXlsx(sheets: SheetData[]): Uint8Array<ArrayBuffer> {
  const names = sheetNames(sheets);
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('') +
        '</Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ],
    [
      'xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets>${names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        `<definedNames>${sheets
          .map((s, i) => {
            const ref = `'${names[i]!.replace(/'/g, "''")}'!$A$1:$${columnLetter(Math.max(0, s.columns.length - 1))}$${s.rows.length + 1}`;
            return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlText(ref)}</definedName>`;
          })
          .join('')}</definedNames>` +
        '</workbook>',
    ],
    [
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    ],
    ['xl/styles.xml', STYLES_XML],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return zip(files.map(([name, text]) => ({ name, data: new TextEncoder().encode(text) })));
}

// ── zip (deflate, no encryption, no zip64: fine for files well under 4 GB) ──

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function zip(entries: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const compressed = new Uint8Array(deflateRawSync(entry.data));
    const crc = crc32(entry.data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 8, true); // deflate
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, compressed.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, compressed);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true); // version needed
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 8, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, compressed.length, true);
    central.setUint32(24, entry.data.length, true);
    central.setUint16(28, name.length, true);
    // extra, comment, disk, internal and external attributes: all zero
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);

    offset += 30 + name.length + compressed.length;
  }

  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
