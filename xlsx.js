// Générateur .xlsx minimal, sans dépendance (Office Open XML + ZIP "deflate").
// sheets: [{ name, columns: [{ header, width }], rows: [[cell, ...], ...] }]
// cell: null | string | number | { date: <timestamp ms>, hasTime: bool }

const enc = new TextEncoder();

function esc(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function colName(i) {
  let s = '';
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

// Numéro de série Excel en heure locale
function excelSerial(ts) {
  const d = new Date(ts);
  return ts / 86400000 + 25569 - d.getTimezoneOffset() / 1440;
}

// Styles : [normal, groupe]  (index des cellXfs)
const ST = {
  '': { t: 0, n: 0, dt: 2, d: 3, tm: 4, p: 5 },
  g: { t: 6, n: 8, dt: 7, d: 9, tm: 10, p: 11 },
};

function cellXml(ref, v, kind) {
  if (kind === 'h') return `<c r="${ref}" t="inlineStr" s="1"><is><t>${esc(v ?? '')}</t></is></c>`;
  const S = ST[kind || ''];
  if (v === null || v === undefined || v === '') return kind === 'g' ? `<c r="${ref}" s="${S.t}"/>` : '';
  if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}" s="${S.n}"><v>${v}</v></c>`;
  if (typeof v === 'object') {
    if (v.date != null) return `<c r="${ref}" s="${v.hasTime ? S.dt : S.d}"><v>${excelSerial(v.date)}</v></c>`;
    if (v.time != null) { const x = excelSerial(v.time); return `<c r="${ref}" s="${S.tm}"><v>${x - Math.floor(x)}</v></c>`; }
    if (v.pct != null) return `<c r="${ref}" s="${S.p}"><v>${v.pct}</v></c>`;
    return '';
  }
  return `<c r="${ref}" t="inlineStr" s="${S.t}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

// sheet.rows : tableau de lignes ; une ligne = [cellules] ou { cells, kind: 'g', outline: 1 }
function sheetXml(sheet) {
  const ncol = sheet.columns.length;
  const lastCol = colName(ncol - 1);
  const rows = [{ cells: sheet.columns.map((c) => c.header), kind: 'h' }, ...sheet.rows.map((r) => (Array.isArray(r) ? { cells: r } : r))];
  const hasOutline = rows.some((r) => r.outline);
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 15}" customWidth="1"/>`)
    .join('');
  const data = rows
    .map((r, ri) => {
      const cells = [];
      for (let ci = 0; ci < ncol; ci++) cells.push(cellXml(`${colName(ci)}${ri + 1}`, r.cells[ci], r.kind));
      const ol = r.outline ? ` outlineLevel="${r.outline}"${sheet.collapsed ? ' hidden="1"' : ''}` : '';
      const coll = sheet.collapsed && r.kind === 'g' ? ' collapsed="1"' : '';
      return `<row r="${ri + 1}"${ol}${coll}>${cells.join('')}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    (hasOutline ? '<sheetPr><outlinePr summaryBelow="0"/></sheetPr>' : '') +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<sheetFormatPr defaultRowHeight="15"${hasOutline ? ' outlineLevelRow="1"' : ''}/>` +
    `<cols>${cols}</cols><sheetData>${data}</sheetData>` +
    (sheet.noFilter ? '' : `<autoFilter ref="A1:${lastCol}${rows.length}"/>`) +
    '</worksheet>'
  );
}

const XF = (fmt, font, fill) =>
  `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>`;
const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="hh:mm"/></numFmts>' +
  '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF6C4DFF"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEFEBFF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="12">' +
  XF(0, 0, 0) + XF(0, 1, 2) + XF(164, 0, 0) + XF(165, 0, 0) + XF(166, 0, 0) + XF(9, 0, 0) +
  XF(0, 2, 3) + XF(164, 2, 3) + XF(0, 2, 3) + XF(165, 2, 3) + XF(166, 2, 3) + XF(9, 2, 3) +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function cleanSheetName(n, used) {
  let s = String(n).replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 31) || 'Feuille';
  let base = s, k = 2;
  while (used.has(s.toLowerCase())) s = `${base.slice(0, 28)} ${k++}`;
  used.add(s.toLowerCase());
  return s;
}

// ---------- ZIP ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = enc.encode(f.data);
    const comp = await deflateRaw(raw);
    const crc = crc32(raw);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0, true);
    lh.setUint16(8, 8, true);
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, comp.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, comp);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0, true);
    ch.setUint16(10, 8, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, comp.length, true);
    ch.setUint32(24, raw.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);

    offset += 30 + name.length + comp.length;
  }

  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of all) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export async function buildXlsx(sheets) {
  const used = new Set();
  const names = sheets.map((s) => cleanSheetName(s.name, used));
  const files = [
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' +
        names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets>' +
        (sheets.some((s) => !s.noFilter) ? '<definedNames>' : '') +
        sheets
          .filter((s) => !s.noFilter)
          .map((s) => [s, sheets.indexOf(s)])
          .map(([s, i]) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i])}'!$A$1:$${colName(s.columns.length - 1)}$${s.rows.length + 1}</definedName>`)
          .join('') +
        (sheets.some((s) => !s.noFilter) ? '</definedNames>' : '') +
        '</workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zip(files);
}
