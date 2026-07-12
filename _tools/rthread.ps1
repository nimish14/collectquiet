param(
    [string]$Permalink,
    [int]$MaxComments = 15
)
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
$link = $Permalink.TrimEnd('/')
if ($link -notmatch "^https") { $link = "https://www.reddit.com$link" }
$url = "$link.json?limit=$MaxComments&sort=top"
$raw = curl.exe -s -A $ua $url
try { $j = $raw | ConvertFrom-Json } catch { Write-Output "PARSE FAIL: $($raw.Substring(0,[Math]::Min(200,$raw.Length)))"; exit 1 }
$post = $j[0].data.children[0].data
$date = [DateTimeOffset]::FromUnixTimeSeconds([long]$post.created_utc).ToString("yyyy-MM-dd")
Write-Output "===== POST [$date] r/$($post.subreddit) score=$($post.score) comments=$($post.num_comments)"
Write-Output "TITLE: $($post.title)"
Write-Output "AUTHOR: $($post.author)"
Write-Output "BODY: $(($post.selftext -replace "\s+"," "))"
Write-Output ""
Write-Output "===== TOP COMMENTS:"
foreach ($c in $j[1].data.children) {
    if ($c.kind -ne "t1") { continue }
    $d = $c.data
    $cdate = [DateTimeOffset]::FromUnixTimeSeconds([long]$d.created_utc).ToString("yyyy-MM-dd")
    $body = ($d.body -replace "\s+", " ")
    if ($body.Length -gt 800) { $body = $body.Substring(0, 800) + "..." }
    Write-Output "--- [$cdate] u/$($d.author) score=$($d.score)"
    Write-Output $body
    Write-Output ""
}
