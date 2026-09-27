/* global report, element */
const testModeLabels = { 'test-account-service': '测试账号 · 服务端', 'simulated-role': '模拟角色 · 页面', 'devtools': '开发者工具 · 真实会话', 'device': '微信真机', 'automated-contract': '自动化合同测试' }
const testStatusLabels = { pass: '已通过', fail: '未通过', pending: '待测' }
const testRoot = document.getElementById('public-test-results')
const testCases = report.testResults.cases
const passedCases = testCases.filter(item => item.status === 'pass').length
testRoot.append(element('p', `本轮 ${testCases.length} 项记录，${passedCases} 项通过。服务端与模拟角色测试不替代真实微信登录、手机号、支付和扫码验收。`))
for (const item of testCases) {
  const row = element('div', undefined, 'test-row')
  row.append(element('strong', `${testStatusLabels[item.status]} · ${testModeLabels[item.mode]} · ${item.summary}`))
  if (item.stepIds.length) {
    const links = element('p', '关联页面：')
    for (const id of item.stepIds) {
      const link = element('a', `${id} `)
      link.href = `#${id}`
      links.append(link)
    }
    row.append(links)
  }
  if (item.evidence) {
    row.append(element('p', `证据：${item.evidence}`))
  }
  if (item.limitations?.length) {
    row.append(element('p', `范围：${item.limitations.join('；')}`))
  }
  testRoot.append(row)
}
