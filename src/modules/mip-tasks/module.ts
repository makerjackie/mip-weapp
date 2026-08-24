import type { AdminCompletionFilters, MipTasksGateway, TaskExportResult } from './types'

function writeFile(filePath: string, base64: string) {
  return new Promise<void>((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath,
      data: base64,
      encoding: 'base64',
      success: () => resolve(),
      fail: reject,
    })
  })
}

function openWorkbook(filePath: string) {
  return new Promise<void>((resolve, reject) => {
    wx.openDocument({
      filePath,
      fileType: 'xlsx',
      showMenu: true,
      success: () => resolve(),
      fail: reject,
    })
  })
}

function downloadImage(url: string) {
  return new Promise<string>((resolve, reject) => {
    wx.downloadFile({
      url,
      success: result => result.statusCode === 200 ? resolve(result.tempFilePath) : reject(new Error('模板下载失败')),
      fail: reject,
    })
  })
}

function saveImage(filePath: string) {
  return new Promise<void>((resolve, reject) => {
    wx.saveImageToPhotosAlbum({ filePath, success: () => resolve(), fail: reject })
  })
}

export function createMipTasksModule(gateway: MipTasksGateway) {
  async function exportAndOpen(filters?: AdminCompletionFilters): Promise<Omit<TaskExportResult, 'contentBase64'>> {
    const result = await gateway.exportCompletions(filters)
    const safeName = result.fileName.replace(/[^\w.-]/g, '-').slice(0, 100)
    const filePath = `${wx.env.USER_DATA_PATH}/${safeName || 'mip-task-completions.xlsx'}`
    await writeFile(filePath, result.contentBase64)
    await openWorkbook(filePath)
    return { fileName: result.fileName, rowCount: result.rowCount }
  }

  return {
    gateway,
    exportAndOpen,
    async saveTemplateImage(url: string) {
      if (!url || /^cloud:\/\//.test(url) || /^http:\/\//.test(url)) {
        throw new Error('模板下载地址无效')
      }
      const filePath = /^https:\/\//.test(url) ? await downloadImage(url) : url
      await saveImage(filePath)
    },
  }
}
