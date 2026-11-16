import { describe, expect, test } from 'bun:test'
import {
  isLeapYear,
  daysInMonth,
  parseYmd,
  formatYmd,
  ymdCompare,
  addMonthsYmd,
  dayOfWeek,
} from '../src/scheduler/cal'
import {
  nextMonthlyFire,
  nextWeeklyFire,
  nextFireSeries,
  type MonthlyJob,
} from '../src/scheduler/jobs'

describe('calendar primitives', () => {
  test('leap years', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2026)).toBe(false)
    expect(isLeapYear(1900)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
  })
  test('february length follows leap rule', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2024, 2)).toBe(29)
  })
  test('parseYmd validates day against month; format round-trips', () => {
    expect(formatYmd(parseYmd('2026-02-28'))).toBe('2026-02-28')
    expect(() => parseYmd('2026-02-29')).toThrow()
    expect(() => parseYmd('2026-13-01')).toThrow()
  })
  test('ymdCompare ordering', () => {
    expect(ymdCompare(parseYmd('2026-01-02'), parseYmd('2026-01-03'))).toBe(-1)
    expect(ymdCompare(parseYmd('2026-03-01'), parseYmd('2026-02-28'))).toBe(1)
    expect(ymdCompare(parseYmd('2026-05-05'), parseYmd('2026-05-05'))).toBe(0)
  })
})

describe('addMonthsYmd (spec §2)', () => {
  test('clamps day, never overflows the month', () => {
    expect(addMonthsYmd(parseYmd('2026-01-31'), 1)).toEqual({ y: 2026, m: 2, d: 28 })
    expect(addMonthsYmd(parseYmd('2026-01-31'), 2)).toEqual({ y: 2026, m: 3, d: 31 })
    expect(addMonthsYmd(parseYmd('2024-01-31'), 1)).toEqual({ y: 2024, m: 2, d: 29 })
  })
  test('year rollover', () => {
    expect(addMonthsYmd(parseYmd('2026-11-15'), 3)).toEqual({ y: 2027, m: 2, d: 15 })
    expect(addMonthsYmd(parseYmd('2026-12-31'), 14)).toEqual({ y: 2028, m: 2, d: 29 })
  })
  test('n = 0 is identity; negative throws', () => {
    expect(addMonthsYmd(parseYmd('2026-07-04'), 0)).toEqual({ y: 2026, m: 7, d: 4 })
    expect(() => addMonthsYmd(parseYmd('2026-07-04'), -1)).toThrow()
  })
})

describe('dayOfWeek (Sakamoto)', () => {
  test('known anchors', () => {
    // 2026-01-01 is a Thursday
    expect(dayOfWeek(parseYmd('2026-01-01'))).toBe(4)
    // 2000-01-01 was a Saturday
    expect(dayOfWeek(parseYmd('2000-01-01'))).toBe(6)
  })
})

describe('nextMonthlyFire (spec §3)', () => {
  test('day-31 job clamps in short months', () => {
    const j: MonthlyJob = { kind: 'monthly', dom: 31 }
    expect(nextMonthlyFire(j, parseYmd('2026-04-10'))).toEqual({ y: 2026, m: 4, d: 30 })
    expect(nextMonthlyFire(j, parseYmd('2026-02-01'))).toEqual({ y: 2026, m: 2, d: 28 })
  })
  test('STRICTLY after: April-30 with dom 31 must roll to May-31', () => {
    // The clamped candidate for April is 2026-04-30, which equals `from`,
    // so it is NOT strictly after — the answer is May's candidate.
    const j: MonthlyJob = { kind: 'monthly', dom: 31 }
    expect(nextMonthlyFire(j, parseYmd('2026-04-30'))).toEqual({ y: 2026, m: 5, d: 31 })
  })
  test('exact same dom also rolls forward', () => {
    const j: MonthlyJob = { kind: 'monthly', dom: 15 }
    expect(nextMonthlyFire(j, parseYmd('2026-06-15'))).toEqual({ y: 2026, m: 7, d: 15 })
    expect(nextMonthlyFire(j, parseYmd('2026-06-14'))).toEqual({ y: 2026, m: 6, d: 15 })
  })
  test('December rolls into January', () => {
    const j: MonthlyJob = { kind: 'monthly', dom: 20 }
    expect(nextMonthlyFire(j, parseYmd('2026-12-20'))).toEqual({ y: 2027, m: 1, d: 20 })
  })
})

describe('nextWeeklyFire (spec §4)', () => {
  test('from a Thursday, next Sunday is 3 days out', () => {
    // 2026-01-01 is Thu(4); Sunday(0) is 2026-01-04
    expect(nextWeeklyFire({ kind: 'weekly', dow: 0 }, parseYmd('2026-01-01'))).toEqual({
      y: 2026,
      m: 1,
      d: 4,
    })
  })
  test('same weekday lands exactly 7 days later', () => {
    expect(nextWeeklyFire({ kind: 'weekly', dow: 4 }, parseYmd('2026-01-01'))).toEqual({
      y: 2026,
      m: 1,
      d: 8,
    })
  })
  test('crosses month boundary', () => {
    // 2026-01-31 is a Saturday(6); next Sunday is 2026-02-01
    expect(nextWeeklyFire({ kind: 'weekly', dow: 0 }, parseYmd('2026-01-31'))).toEqual({
      y: 2026,
      m: 2,
      d: 1,
    })
  })
})

describe('nextFireSeries (spec §5)', () => {
  test('dom-31 series is strictly ascending and clamps each month', () => {
    const j: MonthlyJob = { kind: 'monthly', dom: 31 }
    const s = nextFireSeries(j, parseYmd('2026-01-15'), 4)
    expect(s).toEqual([
      { y: 2026, m: 1, d: 31 },
      { y: 2026, m: 2, d: 28 },
      { y: 2026, m: 3, d: 31 },
      { y: 2026, m: 4, d: 30 },
    ])
  })
  test('weekly series steps by exactly 7 days', () => {
    // 2026-03-04 is a Wednesday; next Tuesday is 2026-03-10.
    const s = nextFireSeries({ kind: 'weekly', dow: 2 }, parseYmd('2026-03-04'), 3)
    expect(s).toEqual([
      { y: 2026, m: 3, d: 10 },
      { y: 2026, m: 3, d: 17 },
      { y: 2026, m: 3, d: 24 },
    ])
  })
})
