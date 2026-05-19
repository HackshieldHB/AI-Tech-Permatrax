$loginBody = '{"email":"admin@permatrax.com","password":"AdminPassword123!"}'
$t = (Invoke-RestMethod 'http://localhost:3001/api/auth/login' -Method POST -ContentType 'application/json' -Body $loginBody).accessToken

$boundary = [System.Guid]::NewGuid().ToString()
$content = 'test content'
$fileName = 'test.txt'
$body = '--' + $boundary + "`r`n" +
  'Content-Disposition: form-data; name="file"; filename="' + $fileName + '"' + "`r`n" +
  'Content-Type: text/plain' + "`r`n`r`n" +
  $content + "`r`n--" + $boundary + '--'

$uploadResult = Invoke-RestMethod 'http://localhost:3001/api/storage/upload?key=test/2026/test.txt' `
  -Method POST `
  -Headers @{ Authorization = ('Bearer ' + $t) } `
  -ContentType ('multipart/form-data; boundary=' + $boundary) `
  -Body $body

Write-Output ('Upload result: ' + $uploadResult.url)

$fileContent = Invoke-RestMethod $uploadResult.url -Method GET
Write-Output ('File content: ' + $fileContent)
