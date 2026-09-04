#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { compactEnvDocuments, writeEnvFileAtomic } from './lib/mip-local-secrets.mjs'

const root = path.resolve(import.meta.dirname, '..')
const localPath = path.join(root, '.env.local')
const secretsPath = path.join(root, '.env.secrets.local')
const localSource = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : ''
const secretsSource = fs.existsSync(secretsPath) ? fs.readFileSync(secretsPath, 'utf8') : ''
const result = compactEnvDocuments(localSource, secretsSource)

writeEnvFileAtomic(secretsPath, result.secrets)
writeEnvFileAtomic(localPath, result.local)
console.log(`[env:compact] stored ${result.movedKeys.length} non-empty secret/config values; retained ${result.local.split(/\r?\n/).filter(line => /^[A-Z_]\w*=/.test(line)).length} local values`)
