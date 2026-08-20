'use strict'

const { deflateRawSync, inflateRawSync } = require('node:zlib')

/**
 * Minimal XLSX (Office Open XML) builder without external dependencies.
 * Produces a valid zip with one sheet and shared strings for offline openDocument.
 */

function crc32(buffer) {
  let crc = 0xFFFFFFFF
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index]
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xEDB88320 & mask)
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

function zipStore(files) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8')
    const compressed = deflateRawSync(data)
    const crc = crc32(data)
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
    ])
    localParts.push(localHeader, compressed)

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ])
    centralParts.push(centralHeader)
    offset += localHeader.length + compressed.length
  }

  const central = Buffer.concat(centralParts)
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
  return Buffer.concat([...localParts, central, end])
}

/**
 * Extract stored/deflated entries from a simple ZIP produced by zipStore.
 * Sufficient for contract tests; not a full ZIP implementation.
 */
function unzipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    throw new Error('INVALID_XLSX')
  }
  const entries = new Map()
  let offset = 0
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset)
    if (signature !== 0x04034b50) {
      break
    }
    const compression = buffer.readUInt16LE(offset + 8)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const name = buffer.slice(nameStart, nameStart + nameLength).toString('utf8')
    const dataStart = nameStart + nameLength + extraLength
    const compressed = buffer.slice(dataStart, dataStart + compressedSize)
    let data
    if (compression === 0) {
      data = compressed
    }
    else if (compression === 8) {
      data = inflateRawSync(compressed)
    }
    else {
      throw new Error(`UNSUPPORTED_ZIP_COMPRESSION:${compression}`)
    }
    entries.set(name, data)
    offset = dataStart + compressedSize
  }
  return entries
}

/**
 * XML 1.0 forbids most C0 controls (NUL, BEL, etc.). Strip them after
 * normalizing whitespace so shared strings remain well-formed.
 */
function stripXml10IllegalControls(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function xmlEscape(value) {
  return stripXml10IllegalControls(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function columnName(index) {
  let n = index
  let name = ''
  while (n >= 0) {
    name = String.fromCharCode((n % 26) + 65) + name
    n = Math.floor(n / 26) - 1
  }
  return name
}

/**
 * count = total cell references into the table
 * uniqueCount = number of unique shared string items
 */
function buildSharedStrings(strings, totalRefCount) {
  const items = strings.map(value => `<si><t>${xmlEscape(value)}</t></si>`).join('')
  const uniqueCount = strings.length
  const count = Number.isInteger(totalRefCount) ? totalRefCount : uniqueCount
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${count}" uniqueCount="${uniqueCount}">`
    + `${items}</sst>`
}

function buildSheet(rows, sharedIndex) {
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((cell, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`
      const index = sharedIndex.get(cell)
      return `<c r="${ref}" t="s"><v>${index}</v></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetData>${sheetRows}</sheetData></worksheet>`
}

/**
 * Build a roster workbook. Cells are plain strings; formula-leading values are neutralized.
 */
function buildRosterXlsx(rows) {
  const header = ['昵称', '联系电话', '城市', '报名状态', '报名时间', '签到时间', '票码（掩码）']
  const statusLabels = {
    REGISTERED: '已报名',
    ATTENDED: '已签到',
    CANCELLED: '已取消',
  }
  const dataRows = rows.map(row => [
    neutralize(row.nickname),
    neutralize(row.phoneNumber),
    neutralize(row.city),
    neutralize(statusLabels[row.status] || row.status || ''),
    neutralize(row.registeredAt || ''),
    neutralize(row.attendedAt || ''),
    neutralize(row.ticketCodeMasked || ''),
  ])
  const matrix = [header, ...dataRows]
  const shared = []
  const sharedIndex = new Map()
  let totalRefCount = 0
  for (const row of matrix) {
    for (const cell of row) {
      totalRefCount += 1
      if (!sharedIndex.has(cell)) {
        sharedIndex.set(cell, shared.length)
        shared.push(cell)
      }
    }
  }

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    + `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`
    + `</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets><sheet name="名单" sheetId="1" r:id="rId1"/></sheets></workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
    + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
    + `</Relationships>`

  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', data: buildSheet(matrix, sharedIndex) },
    { name: 'xl/sharedStrings.xml', data: buildSharedStrings(shared, totalRefCount) },
  ])
}

function neutralize(value) {
  let text = value === null || value === undefined ? '' : String(value)
  // Collapse whitespace first, then strip remaining XML 1.0 illegal controls (incl. NUL).
  text = text.replace(/[\r\n\t]+/g, ' ')
  text = stripXml10IllegalControls(text).trim()
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`
  }
  return text
}

/**
 * Parse a generated roster XLSX and return shared string values + sheet indices.
 * Used by contract tests to prove control-char stripping, formula prefix, and Chinese cells.
 */
function parseRosterXlsx(buffer) {
  const entries = unzipEntries(buffer)
  const sharedXml = entries.get('xl/sharedStrings.xml')
  const sheetXml = entries.get('xl/worksheets/sheet1.xml')
  if (!sharedXml || !sheetXml) {
    throw new Error('INVALID_XLSX')
  }
  const sharedText = sharedXml.toString('utf8')
  const countMatch = sharedText.match(/\bcount="(\d+)"/)
  const uniqueMatch = sharedText.match(/\buniqueCount="(\d+)"/)
  const strings = []
  const siRe = /<si><t>([\s\S]*?)<\/t><\/si>/g
  let match
  while ((match = siRe.exec(sharedText)) !== null) {
    strings.push(match[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&'))
  }
  const values = []
  const valueRe = /<v>(\d+)<\/v>/g
  const sheetText = sheetXml.toString('utf8')
  while ((match = valueRe.exec(sheetText)) !== null) {
    const index = Number(match[1])
    values.push(strings[index] ?? null)
  }
  return {
    count: countMatch ? Number(countMatch[1]) : null,
    uniqueCount: uniqueMatch ? Number(uniqueMatch[1]) : null,
    sharedStrings: strings,
    cellValues: values,
  }
}

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLSX_MAGIC = Buffer.from([0x50, 0x4B, 0x03, 0x04]) // PK..

function isXlsxBuffer(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 4
    && buffer[0] === 0x50
    && buffer[1] === 0x4B
    && buffer[2] === 0x03
    && buffer[3] === 0x04
}

module.exports = {
  XLSX_CONTENT_TYPE,
  XLSX_MAGIC,
  buildRosterXlsx,
  buildSharedStrings,
  isXlsxBuffer,
  neutralize,
  parseRosterXlsx,
  stripXml10IllegalControls,
  unzipEntries,
}
