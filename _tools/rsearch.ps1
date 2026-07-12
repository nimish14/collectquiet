param(
    [string]$Sub,
    [string]$Query,
    [string]$Time = "year",
    [int]$Limit = 8
)
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
$q = [uri]::EscapeDataString($Query)
$url = "https://www.reddit.com/r/$Sub/search.json?q=$q&restrict_sr=on&sort=relevance&t=$Time&limit=$Limit"
$raw = curl.exe -s -A $ua $url
try { $j = $raw | ConvertFrom-Json } catch { Write-Output "PARSE FAIL: $($raw.Substring(0,[Math]::Min(200,$raw.Length)))"; exit 1 }
foreach ($c in $j.data.children) {
    $d = $c.data
    $date = [DateTimeOffset]::FromUnixTimeSeconds([long]$d.created_utc).ToString("yyyy-MM-dd")
    $text = ($d.selftext -replace "\s+", " ")
    if ($text.Length -gt 400) { $text = $text.Substring(0, 400) + "..." }
    Write-Output "=== [$date] score=$($d.score) comments=$($d.num_comments)"
    Write-Output "TITLE: $($d.title)"
    Write-Output "URL: https://www.reddit.com$($d.permalink)"
    Write-Output "TEXT: $text"
    Write-Output ""
}
