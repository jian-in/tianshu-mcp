//! 最小 ISO-8601（UTC）时间戳解析 —— 只为「验收耗时」差值服务（计划 D6）。
//!
//! 为什么不引时间库：`Cargo.toml` 现状没有任何时间库（计划事实 12），而这里只需要
//! `startedAt → finishedAt` 的毫秒差；为一个差值引依赖不划算（且会扩大 CI 构建面）。
//!
//! **解析失败一律 `None`**：调用方据此把该报告排除在「平均验收耗时」之外，
//! 绝不编造时间。

/// 解析 `YYYY-MM-DDTHH:MM:SS(.sss…)?Z` 为 Unix epoch 毫秒；不匹配返回 `None`。
///
/// 仅支持 UTC（`Z` 结尾）。带偏移量的写法（如 `+08:00`）**刻意不支持**：
/// 落盘真源一律是 JS `toISOString()` 产出的 `Z` 串，遇到别的形态说明数据不是本程序写的，
/// 宁可不算也不猜时区。
pub fn parse_iso_ms(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    // 最短合法形态 "1970-01-01T00:00:00Z" = 20 字节
    if b.len() < 20 || b[b.len() - 1] != b'Z' {
        return None;
    }
    if b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let year = num(&s[0..4])?;
    let month = num(&s[5..7])?;
    let day = num(&s[8..10])?;
    let hour = num(&s[11..13])?;
    let minute = num(&s[14..16])?;
    let second = num(&s[17..19])?;

    if !(1..=12).contains(&month) || !(1..=days_in_month(year, month)).contains(&day) {
        return None;
    }
    // 60 秒为闰秒，容忍；61 及以上判非法。
    if hour > 23 || minute > 59 || second > 60 {
        return None;
    }

    let frac_ms = parse_fraction(&s[19..s.len() - 1])?;
    let days = days_from_civil(year, month, day);
    Some((days * 86_400 + hour * 3_600 + minute * 60 + second) * 1_000 + frac_ms)
}

/// 固定宽度十进制字段；含非数字或位宽不符即 `None`。
fn num(field: &str) -> Option<i64> {
    if field.is_empty() || !field.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    field.parse::<i64>().ok()
}

/// `""`（无小数秒）或 `".<1..=9 位数字>"` → 毫秒（取前 3 位，不足右补零）。
fn parse_fraction(rest: &str) -> Option<i64> {
    if rest.is_empty() {
        return Some(0);
    }
    let digits = rest.strip_prefix('.')?;
    if digits.is_empty() || digits.len() > 9 || !digits.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let mut ms = 0_i64;
    let mut taken = 0_u32;
    for c in digits.bytes().take(3) {
        ms = ms * 10 + i64::from(c - b'0');
        taken += 1;
    }
    while taken < 3 {
        ms *= 10;
        taken += 1;
    }
    Some(ms)
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(y) => 29,
        2 => 28,
        _ => 0,
    }
}

/// Howard Hinnant 的 civil-days 算法：公历日期 → 距 `1970-01-01` 的天数（可为负）。
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = (m + 9) % 12; // 3 月为 0，与算法约定一致
    let doy = (153 * mp + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_and_second_precision() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso_ms("1970-01-01T00:00:01Z"), Some(1_000));
        // 2000-03-01T00:00:00Z = 951 868 800 s（跨越 2000 年 2 月的 29 天）
        assert_eq!(parse_iso_ms("2000-03-01T00:00:00Z"), Some(951_868_800_000));
    }

    #[test]
    fn milliseconds_are_kept_and_truncated_to_three_digits() {
        let base = parse_iso_ms("2026-01-02T03:04:05Z").expect("基础时间");
        assert_eq!(parse_iso_ms("2026-01-02T03:04:05.678Z"), Some(base + 678));
        assert_eq!(parse_iso_ms("2026-01-02T03:04:05.6Z"), Some(base + 600));
        // 超过 3 位的精度按毫秒截断（不四舍五入）
        assert_eq!(parse_iso_ms("2026-01-02T03:04:05.6789Z"), Some(base + 678));
    }

    #[test]
    fn leap_year_rules() {
        assert!(parse_iso_ms("2024-02-29T00:00:00Z").is_some());
        assert!(parse_iso_ms("2023-02-29T00:00:00Z").is_none()); // 平年无 2/29
        assert!(parse_iso_ms("1900-02-29T00:00:00Z").is_none()); // 整百年非闰
        assert!(parse_iso_ms("2000-02-29T00:00:00Z").is_some()); // 400 年闰
    }

    #[test]
    fn invalid_inputs_return_none() {
        for bad in [
            "",
            "not-a-time",
            "2026-01-02T03:04:05",       // 缺 Z
            "2026-01-02T03:04:05+08:00", // 不支持偏移量
            "2026-13-01T00:00:00Z",      // 月份越界
            "2026-01-32T00:00:00Z",      // 日越界
            "2026-01-02T24:00:00Z",      // 小时越界
            "2026-01-02 03:04:05Z",      // 分隔符错误
            "2026-01-02T03:04:05.Z",     // 小数位为空
            "2026-01-02T03:04:05.abcdefgZ",
            "26-01-02T03:04:05Z", // 位宽不符
        ] {
            assert_eq!(parse_iso_ms(bad), None, "应判非法：{bad:?}");
        }
    }

    #[test]
    fn ordering_is_monotonic() {
        let a = parse_iso_ms("2026-09-26T13:52:00.000Z").expect("a");
        let b = parse_iso_ms("2026-09-26T13:52:03.500Z").expect("b");
        assert!(b > a);
        assert_eq!(b - a, 3_500);
    }
}
