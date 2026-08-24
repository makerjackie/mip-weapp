'use strict'

const { deflateRawSync, inflateRawSync } = require('node:zlib')

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function crc32(buffer) {
  let crc = 0xFFFFFFFF
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function u16(value) {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value, 0)
  return buffer
}

function u32(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value, 0)
  return buffer
}

function zip(files) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8')
    const compressed = deflateRawSync(data)
    const checksum = crc32(data)
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(checksum), u32(compressed.length), u32(data.length), u16(name.length), u16(0), name,
    ])
    localParts.push(local, compressed)
    centralParts.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(checksum), u32(compressed.length), u32(data.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]))
    offset += local.length + compressed.length
  }
  const central = Buffer.concat(centralParts)
  return Buffer.concat([
    ...localParts,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(offset), u16(0),
  ])
}

function stripXmlControls(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function neutralize(value) {
  let text = stripXmlControls(value).replace(/[\r\n\t]+/g, ' ').trim()
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return text
}

function xmlEscape(value) {
  return stripXmlControls(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function columnName(index) {
  let value = index
  let name = ''
  while (value >= 0) {
    name = String.fromCharCode((value % 26) + 65) + name
    value = Math.floor(value / 26) - 1
  }
  return name
}

function normalizedSheetName(value) {
  const name = stripXmlControls(value).replace(/[\\/?*\[\]:]/g, '').trim().slice(0, 31)
  return name || '导出'
}

function buildXlsx({ sheetName = '导出', header, rows }) {
  if (!Array.isArray(header) || !header.length || header.length > 64 || !Array.isArray(rows)) {
    throw new Error('EXPORT_WORKBOOK_INVALID')
  }
  const matrix = [header, ...rows].map((row) => {
    if (!Array.isArray(row) || row.length !== header.length) throw new Error('EXPORT_WORKBOOK_INVALID')
    return row.map(neutralize)
  })
  const shared = []
  const sharedIndex = new Map()
  let totalReferences = 0
  for (const row of matrix) {
    for (const cell of row) {
      totalReferences += 1
      if (!sharedIndex.has(cell)) {
        sharedIndex.set(cell, shared.length)
        shared.push(cell)
      }
    }
  }
  const sharedXml = shared.map(value => `<si><t>${xmlEscape(value)}</t></si>`).join('')
  const sheetRows = matrix.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="s"><v>${sharedIndex.get(cell)}</v></c>`).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    + '</Types>'
  const packageRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>'
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${xmlEscape(normalizedSheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
    + '</Relationships>'
  return zip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: packageRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    },
    {
      name: 'xl/sharedStrings.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${totalReferences}" uniqueCount="${shared.length}">${sharedXml}</sst>`,
    },
  ])
}

function unzipEntries(buffer) {
  const entries = new Map()
  let offset = 0
  while (Buffer.isBuffer(buffer) && offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compression = buffer.readUInt16LE(offset + 8)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8')
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
    if (![0, 8].includes(compression)) throw new Error('INVALID_XLSX')
    entries.set(name, compression === 8 ? inflateRawSync(compressed) : compressed)
    offset = dataStart + compressedSize
  }
  return entries
}

function isXlsxBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50
}

module.exports = {
  XLSX_CONTENT_TYPE,
  buildXlsx,
  isXlsxBuffer,
  neutralize,
  stripXmlControls,
  unzipEntries,
}
