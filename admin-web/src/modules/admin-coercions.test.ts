import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { boundedInteger, identifier, nonEmptyString, nonNegativeVersion, positiveVersion, uniqueStringList } from './admin-coercions.ts'

describe('admin coercions', () => {
  it('keeps only safe generic identifiers', () => {
    assert.equal(identifier(' event-1 '), 'event-1')
    assert.equal(identifier('a.b:c_d-e'), 'a.b:c_d-e')
    assert.equal(identifier('has space'), '')
    assert.equal(identifier('x'.repeat(129)), '')
    assert.equal(identifier(42), '')
    assert.equal(identifier(null), '')
  })

  it('treats versions as bounded safe integers or null', () => {
    assert.equal(positiveVersion(3), 3)
    assert.equal(positiveVersion('2'), 2)
    assert.equal(positiveVersion(0), null)
    assert.equal(positiveVersion(1.5), null)
    assert.equal(positiveVersion(undefined), null)

    assert.equal(nonNegativeVersion(0), 0)
    assert.equal(nonNegativeVersion(-1), null)
    assert.equal(nonNegativeVersion(2), 2)

    assert.equal(boundedInteger(3, 1, 5), 3)
    assert.equal(boundedInteger(0, 1, 5), null)
    assert.equal(boundedInteger(6, 1, 5), null)
    assert.equal(boundedInteger('4', 1, 5), 4)
  })

  it('de-duplicates non-empty string lists and ignores other shapes', () => {
    assert.deepEqual(uniqueStringList(['a', 'a', 'b']), ['a', 'b'])
    assert.deepEqual(uniqueStringList([1, 'a', '', '  ']), ['a'])
    assert.deepEqual(uniqueStringList('a'), [])
    assert.deepEqual(uniqueStringList(null), [])
  })

  it('returns only non-empty strings', () => {
    assert.equal(nonEmptyString('ok'), 'ok')
    assert.equal(nonEmptyString(''), undefined)
    assert.equal(nonEmptyString(1), undefined)
    assert.equal(nonEmptyString(undefined), undefined)
  })
})
