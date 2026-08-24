'use strict'

const { deflateRawSync } = require('node:zlib')

function crc32(buffer) {
  let crc = 0xFFFFFFFF
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function numberBuffer(size, value) {
  const buffer = Buffer.alloc(size)
  if (size === 2) buffer.writeUInt16LE(value, 0)
  else buffer.writeUInt32LE(value, 0)
  return buffer
}

function zip(files) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const data = Buffer.from(String(file.data), 'utf8')
    const compressed = deflateRawSync(data)
    const checksum = crc32(data)
    const local = Buffer.concat([
      numberBuffer(4, 0x04034b50), numberBuffer(2, 20), numberBuffer(2, 0), numberBuffer(2, 8),
      numberBuffer(2, 0), numberBuffer(2, 0), numberBuffer(4, checksum), numberBuffer(4, compressed.length),
      numberBuffer(4, data.length), numberBuffer(2, name.length), numberBuffer(2, 0), name,
    ])
    localParts.push(local, compressed)
    centralParts.push(Buffer.concat([
      numberBuffer(4, 0x02014b50), numberBuffer(2, 20), numberBuffer(2, 20), numberBuffer(2, 0),
      numberBuffer(2, 8), numberBuffer(2, 0), numberBuffer(2, 0), numberBuffer(4, checksum),
      numberBuffer(4, compressed.length), numberBuffer(4, data.length), numberBuffer(2, name.length),
      numberBuffer(2, 0), numberBuffer(2, 0), numberBuffer(2, 0), numberBuffer(2, 0),
      numberBuffer(4, 0), numberBuffer(4, offset), name,
    ]))
    offset += local.length + compressed.length
  }
  const central = Buffer.concat(centralParts)
  return Buffer.concat([
    ...localParts,
    central,
    numberBuffer(4, 0x06054b50), numberBuffer(2, 0), numberBuffer(2, 0),
    numberBuffer(2, files.length), numberBuffer(2, files.length), numberBuffer(4, central.length),
    numberBuffer(4, offset), numberBuffer(2, 0),
  ])
}

function safeCell(value) {
  let result = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[\r\n\t]+/g, ' ').trim()
  if (/^[=+\-@]/.test(result)) result = `'${result}`
  return result.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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

function buildTaskWorkbook(rows) {
  const matrix = [[
    '用户', '任务', '完成时间', '附件', '奖励经验值', '处理结果',
  ], ...rows.map(row => [
    row.nickname,
    row.task_name_snapshot,
    new Date(row.completed_at).toISOString(),
    row.attachment_asset_id ? '已提交' : '未提交',
    row.reward_experience,
    row.result_status === 'SUCCESS' ? '成功' : '失败',
  ])]
  const sheetRows = matrix.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${safeCell(cell)}</t></is></c>`).join('')}</row>`).join('')
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
  const packageRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="任务完成流水" sheetId="1" r:id="rId1"/></sheets></workbook>'
  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
  return zip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: packageRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>` },
  ])
}

module.exports = { buildTaskWorkbook, safeCell }
