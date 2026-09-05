const credentialAssignment = /\b\w*(?:app_?secret|api_?v3_?key|wechatpay\w*key|mch_private_key|access_token)["']?[ \t]*[:=][ \t]*(["'`])([^\r\n]*?)\1/gi
const unquotedEnvAssignment = /^[ \t]*(?:export[ \t]+)?\w*(?:app_?secret|api_?v3_?key|wechatpay\w*key|mch_private_key|access_token)[ \t]*=[ \t]*([\w+/=-]{16,})[ \t]*$/gim
const placeholder = /^(?:(?:undefined|null|true|false|disabled)$|(?:test|example|placeholder|dummy|fake|mock|your|replace|changeme)(?:$|[_ -])|<|\$\{)/i

export function detectEmbeddedCredentials(text) {
  const hits = new Set()
  if (/-----BEGIN (?:RSA |EC |ENCRYPTED |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    hits.add('private-key-block')
  }
  for (const match of text.matchAll(credentialAssignment)) {
    const value = match[2].trim()
    if (value.length >= 16 && !placeholder.test(value) && !value.includes('${')) {
      hits.add('credential-literal')
    }
  }
  for (const match of text.matchAll(unquotedEnvAssignment)) {
    if (!placeholder.test(match[1])) {
      hits.add('credential-literal')
    }
  }
  return [...hits]
}
