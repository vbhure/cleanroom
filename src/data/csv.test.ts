import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseCsv } from './csv'

describe('detectDelimiter', () => {
  it('defaults to a comma', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
  })

  it('detects tabs and semicolons', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
  })

  it('ignores delimiters that appear inside quotes', () => {
    // Three semicolons outside quotes beat two commas that are all quoted.
    const text = 'a;b;c;d\n"x,y";"p,q";1;2'
    expect(detectDelimiter(text)).toBe(';')
  })
})

describe('parseCsv', () => {
  it('parses a simple file', () => {
    const { header, rows, warnings } = parseCsv('name,age\nAda,36\nGrace,45')

    expect(header).toEqual(['name', 'age'])
    expect(rows).toEqual([
      ['Ada', '36'],
      ['Grace', '45'],
    ])
    expect(warnings).toEqual([])
  })

  it('handles quoted fields containing the delimiter', () => {
    const { rows } = parseCsv('a,b\n"Hopper, Grace",1')
    expect(rows[0]).toEqual(['Hopper, Grace', '1'])
  })

  it('handles escaped quotes', () => {
    const { rows } = parseCsv('quote\n"She said ""hello"""')
    expect(rows[0]).toEqual(['She said "hello"'])
  })

  it('handles newlines inside quoted fields', () => {
    const { rows } = parseCsv('note,id\n"line one\nline two",7')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(['line one\nline two', '7'])
  })

  it('handles CRLF line endings', () => {
    const { header, rows } = parseCsv('a,b\r\n1,2\r\n3,4\r\n')
    expect(header).toEqual(['a', 'b'])
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('strips a UTF-8 byte order mark from the first header cell', () => {
    const { header } = parseCsv('﻿id,name\n1,Ada')
    expect(header).toEqual(['id', 'name'])
  })

  it('does not emit a phantom row for a trailing newline', () => {
    expect(parseCsv('a\n1\n').rows).toHaveLength(1)
    expect(parseCsv('a\n1').rows).toHaveLength(1)
  })

  it('reports an empty file rather than throwing', () => {
    const result = parseCsv('')
    expect(result.header).toEqual([])
    expect(result.rows).toEqual([])
    expect(result.warnings[0]).toMatch(/empty/i)
  })

  it('accepts a header with no data rows', () => {
    const result = parseCsv('a,b,c')
    expect(result.header).toEqual(['a', 'b', 'c'])
    expect(result.rows).toEqual([])
  })

  it('pads short rows and warns', () => {
    const result = parseCsv('a,b,c\n1,2')
    expect(result.rows[0]).toEqual(['1', '2', ''])
    expect(result.warnings.join(' ')).toMatch(/fewer columns/)
  })

  it('truncates long rows and warns', () => {
    const result = parseCsv('a,b\n1,2,3,4')
    expect(result.rows[0]).toEqual(['1', '2'])
    expect(result.warnings.join(' ')).toMatch(/more columns/)
  })

  it('names blank header cells and de-duplicates repeats', () => {
    const result = parseCsv('id,,id\n1,2,3')
    expect(result.header).toEqual(['id', 'column_2', 'id_2'])
    expect(result.warnings.join(' ')).toMatch(/duplicate column/)
  })

  it('trims whitespace around header names', () => {
    expect(parseCsv('  name , age \n1,2').header).toEqual(['name', 'age'])
  })

  it('respects an explicit delimiter over detection', () => {
    const result = parseCsv('a;b\n1;2', ';')
    expect(result.header).toEqual(['a', 'b'])
    expect(result.rows[0]).toEqual(['1', '2'])
  })

  it('parses a large file without losing rows', () => {
    const lines = ['id,value']
    for (let i = 0; i < 20_000; i += 1) lines.push(`${i},${i * 2}`)
    const result = parseCsv(lines.join('\n'))

    expect(result.rows).toHaveLength(20_000)
    expect(result.rows[19_999]).toEqual(['19999', '39998'])
  })
})
