# ccferry watchdog (scheduled task ccferry-watchdog, every minute).
# Last line of defense: the supervisor loop inside start-daemon.cmd covers
# exe crashes, but if the whole task tree dies together (external kill,
# job-object termination), nothing restarts it. This task notices a missing
# daemon and issues a start. Logs only when it acts.
$p = Get-Process -Name ccferry-client -ErrorAction SilentlyContinue
if (-not $p) {
  schtasks /run /tn ccferry-daemon | Out-Null
  $log = Join-Path $env:USERPROFILE '.ccferry\logs\watchdog.log'
  "$(Get-Date -Format s) daemon down - issued start" | Out-File $log -Append
}
