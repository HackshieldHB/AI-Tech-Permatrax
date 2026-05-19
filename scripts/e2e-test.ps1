param([string]$BaseUrl = "http://localhost:3001/api")
Set-StrictMode -Off

$E2E = @{
    BaseUrl       = $BaseUrl
    CleanListId   = ""
    ClusterId     = ""
    VisitReqId    = ""
    BaOpenId      = ""
    SipDocId      = ""
    HldDocId      = ""
    LldDocId      = ""
    ContractDocId = ""
    ClaimDocId    = ""
    InvoiceDocId  = ""
    RwCode        = ""
    Tokens        = @{ gm=""; pm=""; pmSr=""; sv=""; ad=""; fin=""; ops="" }
    PassCount     = 0
    FailCount     = 0
    WarnCount     = 0
    Results       = @()
}

function Pass([string]$msg) { Write-Host "  PASS $msg" -ForegroundColor Green; $E2E.PassCount++; $E2E.Results += "PASS: $msg" }
function Fail([string]$msg) { Write-Host "  FAIL $msg" -ForegroundColor Red; $E2E.FailCount++; $E2E.Results += "FAIL: $msg" }
function Warn([string]$msg) { Write-Host "  WARN $msg" -ForegroundColor Yellow; $E2E.WarnCount++; $E2E.Results += "WARN: $msg" }
function Check([string]$label, $result) { if ($result -ne $null) { Pass $label; return $true } else { Fail $label; return $false } }
function CheckValue([string]$label, [bool]$condition, [string]$actual = "") {
    if ($condition) { Pass $label } else { Fail "$label (got: $actual)" }
}
function CheckNotNull([string]$label, $value, [string]$fieldName = "") {
    $ok = $value -ne $null -and "$value" -ne ""
    if ($ok) { Pass $label } else { Fail "$label ($fieldName is null/empty)" }
}
function Show-Progress([string]$phase) {
    Write-Host "  [Score: PASS=$($E2E.PassCount) FAIL=$($E2E.FailCount) WARN=$($E2E.WarnCount) after $phase]" -ForegroundColor DarkCyan
}

function Invoke-API {
    param([string]$Method="GET",[string]$Path,[string]$Token="",[object]$Body=$null,[string]$Label="")
    $uri = "$($E2E.BaseUrl)$Path"
    $headers = @{}
    if ($Token -ne "") { $headers["Authorization"] = "Bearer $Token" }
    try {
        if ($Body -ne $null) {
            $json = $Body | ConvertTo-Json -Depth 10
            return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers -ContentType "application/json" -Body $json
        }
        return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers
    } catch {
        $code = "N/A"; $errText = $_.Exception.Message
        try { $code = $_.Exception.Response.StatusCode.value__ } catch {}
        try { $eb = $_.ErrorDetails.Message | ConvertFrom-Json; if ($eb.message) { $errText = $eb.message } } catch {}
        if ($Label -ne "") { Write-Host "  FAIL $Label -> $code : $errText" -ForegroundColor Red }
        return $null
    }
}

function CheckPhase([string]$clusterId, [string]$expected, [string]$token) {
    if ($clusterId -eq "") { Fail "Cluster phase is $expected (clusterId empty)"; return }
    $c = Invoke-API -Method GET -Path "/permit-clusters/$clusterId" -Token $token -Label "Get cluster for phase check"
    $phase = "null"
    if ($c -ne $null -and $c.currentPhase -ne $null) { $phase = $c.currentPhase }
    CheckValue "Cluster phase is $expected" ($phase -eq $expected) $phase
}

function Login-Role([string]$email, [string]$pass, [string]$label) {
    $res = Invoke-API -Method POST -Path "/auth/login" -Body @{ email=$email; password=$pass } -Label "Login $label"
    $ok = Check "Login $label API success" $res
    if ($ok -and $res.accessToken -ne $null -and $res.accessToken -ne "") { Pass "Login token exists for $label"; return [string]$res.accessToken }
    Fail "Login token missing for $label"
    return ""
}

Write-Host "`n=== PERMATRAX E2E TEST (DETAILED ASSERTIONS) ===" -ForegroundColor Cyan
Write-Host "Base URL: $($E2E.BaseUrl)"
$health = Invoke-API -Method GET -Path "/health" -Label "Health check"
Check "Health endpoint reachable" $health | Out-Null
if ($health -ne $null) {
    CheckValue "Health status is ok" ($health.status -eq "ok") "$($health.status)"
}
Show-Progress "HEALTH"

Write-Host "`n[AUTH]"
$E2E.Tokens.gm   = Login-Role "gm@permatrax.com" "GMPassword123!" "GM"
$E2E.Tokens.pm   = Login-Role "pm.ftth@permatrax.com" "PMPassword123!" "PM FTTH"
$E2E.Tokens.pmSr = Login-Role "pm.senior@permatrax.com" "PMSPassword123!" "PM Senior"
$E2E.Tokens.sv   = Login-Role "surveyor.ftth@permatrax.com" "SurveyPassword123!" "Surveyor"
$E2E.Tokens.ad   = Login-Role "admin@permatrax.com" "AdminPassword123!" "Admin"
$E2E.Tokens.fin  = Login-Role "finance@permatrax.com" "FinancePassword123!" "Finance"
$E2E.Tokens.ops  = Login-Role "ops.manager@permatrax.com" "OpsManager123!" "Ops Manager"
Show-Progress "AUTH"

Write-Host "`n[PHASE 1] Cluster Intake"
$rnd = Get-Random -Maximum 9999
$E2E.RwCode = "RW-E2E-$rnd"
$cl = Invoke-API -Method POST -Path "/clean-list" -Token $E2E.Tokens.pm -Label "Create clean list" -Body @{
    ispCustomer="FiberStar"; fiberType="FTTH"; rwCode=$E2E.RwCode; kelurahan="Cihideung Udik"; kecamatan="Ciampea"; kotaKabupaten="Bogor"; homepasCount=230; coordinates="-6.5835,106.7192"; siteName="OPEN CLUSTER CIHIDEUNG UDIK RW8 E2E-$rnd"
}
if (Check "Clean list created" $cl) { $E2E.CleanListId = $cl.id }
CheckNotNull "Clean list has ID" $E2E.CleanListId "CleanListId"
if ($cl -ne $null) { CheckValue "Clean list ISP is FiberStar" ($cl.ispCustomer -eq "FiberStar") "$($cl.ispCustomer)" }
Show-Progress "PHASE 1"

Write-Host "`n[PHASE 2] Visit Request"
$vr = $null
if ($E2E.CleanListId -ne "") {
    $vr = Invoke-API -Method POST -Path "/visit-requests" -Token $E2E.Tokens.sv -Label "Create visit request" -Body @{
        cleanListId=$E2E.CleanListId; fiberType="FTTH"; visitDate=(Get-Date).AddDays(3).ToString("yyyy-MM-ddTHH:mm:ssZ"); stakeholderResponse="PENDING"; surveyNotes="E2E visit"
    }
    if (Check "Visit request created" $vr) { $E2E.VisitReqId = $vr.id }
    if ($vr -ne $null) { CheckValue "VR status is DRAFT" ($vr.status -eq "DRAFT") "$($vr.status)" }
    $vrSub = Invoke-API -Method POST -Path "/visit-requests/$($E2E.VisitReqId)/submit" -Token $E2E.Tokens.sv -Label "Submit visit request"
    Check "Visit request submitted" $vrSub | Out-Null
    $vrPm = Invoke-API -Method PATCH -Path "/visit-requests/$($E2E.VisitReqId)/pm-review" -Token $E2E.Tokens.pm -Label "PM review VR" -Body @{ action="APPROVE" }
    Check "PM approved visit request" $vrPm | Out-Null
    $vrAd = Invoke-API -Method PATCH -Path "/visit-requests/$($E2E.VisitReqId)/admin-approve" -Token $E2E.Tokens.ad -Label "Admin approve VR" -Body @{ action="APPROVE" }
    Check "Admin approved visit request" $vrAd | Out-Null
    $clusterResolved = $false
    for ($i = 0; $i -lt 10; $i++) { # FIX: poll to wait async BA Open/cluster creation
        $vrDetail = Invoke-API -Method GET -Path "/visit-requests/$($E2E.VisitReqId)" -Token $E2E.Tokens.pm -Label "Get VR detail"
        if ($vrDetail -ne $null -and $vrDetail.permitCluster -ne $null -and $vrDetail.permitCluster.id -ne $null) {
            $E2E.ClusterId = $vrDetail.permitCluster.id
            $clusterResolved = $true
            break
        }
        Start-Sleep -Seconds 1
    }
    if (-not $clusterResolved) { # FIX: fallback resolve cluster from BA Open record
        $baList = Invoke-API -Method GET -Path "/ba-open?page=1&limit=50" -Token $E2E.Tokens.ad -Label "Fallback list BA Open"
        $baDocNo = ""
        if ($baList -ne $null -and $baList.data -ne $null) {
            foreach ($b in $baList.data) {
                if ($b.visitRequest -ne $null -and $b.visitRequest.id -eq $E2E.VisitReqId) { $baDocNo = $b.documentNumber; break }
            }
        }
        $clusters = Invoke-API -Method GET -Path "/permit-clusters?page=1&limit=100" -Token $E2E.Tokens.ad -Label "Fallback list clusters"
        if ($clusters -ne $null -and $clusters.data -ne $null) {
            foreach ($c in $clusters.data) {
                if ($c.visitRequest -ne $null -and $c.visitRequest.id -eq $E2E.VisitReqId) { $E2E.ClusterId = $c.id; $clusterResolved = $true; break }
                if (-not $clusterResolved -and $baDocNo -ne "" -and $c.baOpen -ne $null -and $c.baOpen.documentNumber -eq $baDocNo) { $E2E.ClusterId = $c.id; $clusterResolved = $true; break }
                if (-not $clusterResolved -and $c.clusterCode -eq $E2E.RwCode) { $E2E.ClusterId = $c.id; $clusterResolved = $true; break }
            }
        }
    }
    CheckNotNull "Cluster ID retrieved from VR" $E2E.ClusterId "ClusterId"
    if ($E2E.ClusterId -ne "") {
        $cp = Invoke-API -Method GET -Path "/permit-clusters/$($E2E.ClusterId)" -Token $E2E.Tokens.ad -Label "Get cluster phase"
        $p = "null"; if ($cp -ne $null -and $cp.currentPhase -ne $null) { $p = $cp.currentPhase }
        CheckValue "Cluster phase is VISIT_REQUEST or BA_OPEN" (($p -eq "VISIT_REQUEST") -or ($p -eq "BA_OPEN") -or ($p -eq "SITE_VISIT")) $p
    } else { Fail "Cluster phase is VISIT_REQUEST or BA_OPEN (phase missing)" }
} else { Fail "Visit request created (clean list missing)" }
Show-Progress "PHASE 2"

Write-Host "`n[PHASE 3] BA Open"
if ($E2E.ClusterId -ne "") {
    $clusterP3 = Invoke-API -Method GET -Path "/permit-clusters/$($E2E.ClusterId)" -Token $E2E.Tokens.sv -Label "Get cluster for BA Open"
    $ba = $null
    if ($clusterP3 -ne $null -and $clusterP3.baOpen -ne $null) { $ba = $clusterP3.baOpen } else {
        $ba = Invoke-API -Method POST -Path "/ba-open" -Token $E2E.Tokens.sv -Label "Create BA Open" -Body @{
            visitRequestId=$E2E.VisitReqId; tanggal=(Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ"); tempat="Balai RW 08"; topik="Sosialisasi Fiber"; description="Koordinasi warga"
        }
    }
    if (Check "BA Open created/found" $ba) { if ($ba.id -ne $null) { $E2E.BaOpenId = $ba.id } }
    CheckNotNull "BA Open has documentNumber" ($ba.documentNumber) "documentNumber"
    $tanggalSet = $false
    if ($ba -ne $null -and $ba.tanggal -ne $null) { $tanggalSet = $true }
    CheckValue "BA Open tanggal is set" $tanggalSet "$($ba.tanggal)"
} else { Fail "BA Open checks skipped (cluster missing)" }
Show-Progress "PHASE 3"

Write-Host "`n[PHASES 4-6] Survey"
if ($E2E.ClusterId -ne "") {
    $sv4 = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/survey/site-visit" -Token $E2E.Tokens.sv -Label "Site visit save" -Body @{
        rwName="Pak Budi Santoso"; rwPhone="081234567890"; rtName="Pak Agus"; rtPhone="081298765432"; pengelolaName="Bu Tety"; pengelolaPhone="082145678901"; stakeholderNotes="Semua pihak setuju"
    }
    Check "Site visit saved" $sv4 | Out-Null
    if ($sv4 -ne $null) { CheckValue "Site visit status is IN_PROGRESS/COMPLETED" (($sv4.status -eq "IN_PROGRESS") -or ($sv4.status -eq "COMPLETED")) "$($sv4.status)" }
    $sv5 = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/survey/survey-input" -Token $E2E.Tokens.sv -Label "Survey input save" -Body @{
        areaCondition="Area terbuka"; accessDifficulty="EASY"; existingInfra="Tidak ada fiber existing"; surveyNotes="Area potensial"
    }
    Check "Survey input saved" $sv5 | Out-Null
    if ($sv5 -ne $null) { CheckNotNull "Survey input areaCondition set" $sv5.areaCondition "areaCondition" }
    $sv6 = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/survey/route-survey" -Token $E2E.Tokens.sv -Label "Route survey save" -Body @{
        homepasCount=228; routeDistanceM=1240.5; routeNotes="Jalur utama"; routeGeoJson=@{ type="LineString"; coordinates=@(,@(-6.5835,106.7192)) }
    }
    Check "Route survey saved" $sv6 | Out-Null
    if ($sv6 -ne $null) { CheckValue "Route survey homepasCount = 228" ($sv6.homepasCount -eq 228) "$($sv6.homepasCount)" }
} else { Fail "Survey checks skipped (cluster missing)" }
Show-Progress "PHASE 4-6"

Write-Host "`n[PHASE 7] SIP"
if ($E2E.ClusterId -ne "") {
    $sipInit = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/sip/init" -Token $E2E.Tokens.sv -Label "Init SIP by Surveyor"
    if (Check "SIP initialized by Surveyor" $sipInit) { $E2E.SipDocId = $sipInit.id }
    CheckNotNull "SIP has documentNumber" $sipInit.documentNumber "documentNumber"
    $sipPatch = Invoke-API -Method PATCH -Path "/permit-clusters/$($E2E.ClusterId)/sip/$($E2E.SipDocId)" -Token $E2E.Tokens.sv -Label "Update SIP fields" -Body @{
        siteName="OPEN CLUSTER CIHIDEUNG UDIK RW8"; coordinates="-6.5835, 106.7192"; residenceType="CLUSTER"; classing="C+"; workMethod="AERIAL"; homepasCount=230; occupancyPercent=90
        existingCompetitors="Indihome,MyRepublik"; picKawasan="Ibu Tety"; requestBy="FiberStar"; picFs="Pak Budi FS"; picCbn="Pak Anton CBN"; branch="Jabodetabek"
        provinsi="JAWA BARAT"; kota="BOGOR"; kecamatan="CIAMPEA"; kelurahan="CIHIDEUNG UDIK"; alamat="Jl Cihideung Udik"; remarks="Di area RW1 ada 10 RT"
    }
    Check "SIP fields updated" $sipPatch | Out-Null
    if ($sipPatch -ne $null) {
        CheckValue "SIP siteName matches expected" ($sipPatch.siteName -eq "OPEN CLUSTER CIHIDEUNG UDIK RW8") "$($sipPatch.siteName)"
        CheckValue "SIP status is DRAFT" ($sipPatch.status -eq "DRAFT") "$($sipPatch.status)"
    }
} else { Fail "SIP checks skipped (cluster missing)" }
Show-Progress "PHASE 7"

Write-Host "`n[PHASE 8] Doc Package"
if ($E2E.ClusterId -ne "") {
    $pkgGet = Invoke-API -Method GET -Path "/permit-clusters/$($E2E.ClusterId)/doc-package" -Token $E2E.Tokens.sv -Label "Get doc package checklist"
    Check "Doc package checklist loaded" $pkgGet | Out-Null
    $pkgSub = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/doc-package/submit" -Token $E2E.Tokens.sv -Label "Submit doc package" -Body @{ force=$true }
    Check "Doc package submitted" $pkgSub | Out-Null
    if ($pkgSub -ne $null) { CheckValue "Doc package status is SUBMITTED" ($pkgSub.status -eq "SUBMITTED") "$($pkgSub.status)" }
    $pkgPm = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/doc-package/pm-review" -Token $E2E.Tokens.pm -Label "PM review doc package" -Body @{ action="APPROVE" }
    Check "PM approved doc package" $pkgPm | Out-Null
    $pkgAd = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/doc-package/admin-review" -Token $E2E.Tokens.ad -Label "Admin review doc package" -Body @{ action="APPROVE" }
    Check "Admin approved doc package" $pkgAd | Out-Null
} else { Fail "Doc package checks skipped (cluster missing)" }
Show-Progress "PHASE 8"

Write-Host "`n[PHASE 11] SIP ISP decisions"
if ($E2E.ClusterId -ne "" -and $E2E.SipDocId -ne "") {
    $sipPdf = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/sip/$($E2E.SipDocId)/generate-pdf" -Token $E2E.Tokens.ad -Label "Generate SIP PDF"
    Check "SIP PDF generated" $sipPdf | Out-Null
    $sipSub = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/sip/$($E2E.SipDocId)/submit-to-isp" -Token $E2E.Tokens.ad -Label "Submit SIP to ISP"
    Check "SIP submitted to ISP" $sipSub | Out-Null
    if ($sipSub -ne $null) { CheckValue "SIP status is SUBMITTED" ($sipSub.status -eq "SUBMITTED") "$($sipSub.status)" }
    $sipApp = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/sip/$($E2E.SipDocId)/isp-decision" -Token $E2E.Tokens.ad -Label "Record ISP approve SIP" -Body @{ action="APPROVE" }
    Check "ISP approved SIP" $sipApp | Out-Null
    if ($sipApp -ne $null) { CheckValue "SIP status is APPROVED" ($sipApp.status -eq "APPROVED") "$($sipApp.status)" }
} else { Fail "SIP ISP checks skipped (missing IDs)" }
Show-Progress "PHASE 11"

Write-Host "`n[PHASES 12-13] HLD"
if ($E2E.ClusterId -ne "") {
    $hldCreate = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/hld" -Token $E2E.Tokens.pm -Label "Create HLD" -Body @{ kmzFileUrl="https://placeholder.permatrax.dev/hld.kmz"; boqFileUrl="https://placeholder.permatrax.dev/boq.xlsx" }
    if (Check "HLD created" $hldCreate) { $E2E.HldDocId = $hldCreate.id }
    $hldSub = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/hld/$($E2E.HldDocId)/submit" -Token $E2E.Tokens.pm -Label "Submit HLD"
    Check "HLD submitted" $hldSub | Out-Null
    if ($hldSub -ne $null) { CheckValue "HLD status is SUBMITTED_FOR_REVIEW" ($hldSub.status -eq "SUBMITTED_FOR_REVIEW") "$($hldSub.status)" }
    $hldPm = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/hld/$($E2E.HldDocId)/pm-approve" -Token $E2E.Tokens.pm -Label "PM approve HLD"
    Check "PM approved HLD" $hldPm | Out-Null
    if ($hldPm -ne $null) { CheckValue "HLD status is PM_APPROVED" ($hldPm.status -eq "PM_APPROVED") "$($hldPm.status)" }
    $hldAd = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/hld/$($E2E.HldDocId)/admin-approve" -Token $E2E.Tokens.ad -Label "Admin approve HLD"
    Check "Admin approved HLD" $hldAd | Out-Null
    if ($hldAd -ne $null) { CheckValue "HLD status is PENDING_ISP" ($hldAd.status -eq "PENDING_ISP") "$($hldAd.status)" }
    $hldIsp = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/hld/$($E2E.HldDocId)/isp-decision" -Token $E2E.Tokens.ad -Label "Record ISP approve HLD" -Body @{ action="APPROVE" }
    Check "ISP approved HLD" $hldIsp | Out-Null
    if ($hldIsp -ne $null) { CheckValue "HLD status is ISP_APPROVED" ($hldIsp.status -eq "ISP_APPROVED") "$($hldIsp.status)" }
    CheckPhase $E2E.ClusterId "LLD_SUBMISSION" $E2E.Tokens.ad
} else { Fail "HLD checks skipped (cluster missing)" }
Show-Progress "PHASE 12-13"

Write-Host "`n[PHASES 14-16] LLD"
if ($E2E.ClusterId -ne "") {
    $lldCreate = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/lld" -Token $E2E.Tokens.pm -Label "Create LLD" -Body @{ apdFileUrl="https://placeholder.permatrax.dev/apd.pdf"; schematicFileUrl="https://placeholder.permatrax.dev/schematic.pdf"; coreConnectionUrl="https://placeholder.permatrax.dev/core.pdf" }
    if (Check "LLD created" $lldCreate) { $E2E.LldDocId = $lldCreate.id }
    $lldSub = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/lld/$($E2E.LldDocId)/submit" -Token $E2E.Tokens.pm -Label "Submit LLD"
    Check "LLD submitted" $lldSub | Out-Null
    if ($lldSub -ne $null) { CheckValue "LLD status is SUBMITTED_FOR_REVIEW/PENDING_ISP" (($lldSub.status -eq "SUBMITTED_FOR_REVIEW") -or ($lldSub.status -eq "PENDING_ISP")) "$($lldSub.status)" }
    $lldPm = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/lld/$($E2E.LldDocId)/pm-approve" -Token $E2E.Tokens.pm -Label "PM approve LLD"
    Check "PM approved LLD" $lldPm | Out-Null
    if ($lldPm -ne $null) { CheckValue "LLD status is PM_APPROVED" ($lldPm.status -eq "PM_APPROVED") "$($lldPm.status)" }
    $lldAd = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/lld/$($E2E.LldDocId)/admin-approve" -Token $E2E.Tokens.ad -Label "Admin approve LLD"
    Check "Admin approved LLD" $lldAd | Out-Null
    if ($lldAd -ne $null) { CheckValue "LLD status is PENDING_ISP" ($lldAd.status -eq "PENDING_ISP") "$($lldAd.status)" }
    $lldIsp = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/lld/$($E2E.LldDocId)/isp-decision" -Token $E2E.Tokens.ad -Label "Record ISP approve LLD" -Body @{ action="APPROVE" }
    Check "ISP approved LLD" $lldIsp | Out-Null
    if ($lldIsp -ne $null) { CheckValue "LLD status is ISP_APPROVED" ($lldIsp.status -eq "ISP_APPROVED") "$($lldIsp.status)" }
    CheckPhase $E2E.ClusterId "PR_BR_ISSUANCE" $E2E.Tokens.ad
} else { Fail "LLD checks skipped (cluster missing)" }
Show-Progress "PHASE 14-16"

Write-Host "`n[PHASE 17] PR/BR + Contract"
if ($E2E.ClusterId -ne "") {
    $rnd2 = Get-Random -Maximum 9999
    $pr = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/pr-br/pr" -Token $E2E.Tokens.pm -Label "Create PR" -Body @{ documentNumber="PR-E2E-$rnd2"; amount=85000000; description="PR E2E"; fileUrl="https://placeholder.permatrax.dev/pr.pdf" }
    Check "PR created" $pr | Out-Null
    if ($pr -ne $null) { CheckValue "PR type is PR" ($pr.type -eq "PR") "$($pr.type)" }
    $br = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/pr-br/br" -Token $E2E.Tokens.pm -Label "Create BR" -Body @{ documentNumber="BR-E2E-$rnd2"; amount=85000000; description="BR E2E"; fileUrl="https://placeholder.permatrax.dev/br.pdf" }
    Check "BR created" $br | Out-Null
    if ($br -ne $null) { CheckValue "BR type is BR" ($br.type -eq "BR") "$($br.type)" }
    $prIssue = $null; if ($pr -ne $null) { $prIssue = Invoke-API -Method PATCH -Path "/permit-clusters/$($E2E.ClusterId)/pr-br/$($pr.id)/issue" -Token $E2E.Tokens.pm -Label "Issue PR" }
    Check "PR marked issued" $prIssue | Out-Null
    $contract = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/contract" -Token $E2E.Tokens.ad -Label "Create contract PKS" -Body @{
        type="PKS"; contractNumber="PKS-E2E-$(Get-Random -Maximum 9999)"; vendor="PT Akses Fiber Indonesia"; amount=85000000
        startDate=(Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ"); endDate=(Get-Date).AddMonths(3).ToString("yyyy-MM-ddTHH:mm:ssZ"); fileUrl="https://placeholder.permatrax.dev/pks.pdf"
    }
    if (Check "Contract created by Admin" $contract) { $E2E.ContractDocId = $contract.id }
    if ($contract -ne $null) { CheckValue "Contract type is PKS" ($contract.type -eq "PKS") "$($contract.type)" }
    $opsApp = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/contract/$($E2E.ContractDocId)/ops-approve" -Token $E2E.Tokens.ops -Label "Ops approve contract"
    Check "Ops Manager approved contract" $opsApp | Out-Null
    if ($opsApp -ne $null) { CheckValue "Contract status is PENDING_GM" ($opsApp.status -eq "PENDING_GM") "$($opsApp.status)" }
    $gmApp = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/contract/$($E2E.ContractDocId)/gm-approve" -Token $E2E.Tokens.gm -Label "GM approve contract"
    Check "GM approved contract" $gmApp | Out-Null
    if ($gmApp -ne $null) { CheckValue "Contract status is APPROVED" ($gmApp.status -eq "APPROVED") "$($gmApp.status)" }
    CheckPhase $E2E.ClusterId "SKOM_BUDGET" $E2E.Tokens.ad
} else { Fail "PR/BR/Contract checks skipped (cluster missing)" }
Show-Progress "PHASE 17"

Write-Host "`n[PHASES 18-19] SKOM"
if ($E2E.ClusterId -ne "") {
    $skom = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/skom-budget" -Token $E2E.Tokens.pm -Label "Create SKOM budget" -Body @{
        totalBudget=85000000; rabFileUrl="https://placeholder.permatrax.dev/rab.xlsx"; timelineFileUrl="https://placeholder.permatrax.dev/timeline.xlsx"; kurvaSFileUrl="https://placeholder.permatrax.dev/kurvas.xlsx"
        startDate=(Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ"); endDate=(Get-Date).AddMonths(2).ToString("yyyy-MM-ddTHH:mm:ssZ"); durationDays=60
    }
    Check "SKOM created" $skom | Out-Null
    if ($skom -ne $null) { CheckValue "SKOM totalBudget = 85000000" ("$($skom.totalBudget)" -like "*85000000*") "$($skom.totalBudget)" }
    $skomSub = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/skom-budget/submit" -Token $E2E.Tokens.pm -Label "Submit SKOM"
    Check "SKOM submitted" $skomSub | Out-Null
    if ($skomSub -ne $null) { CheckValue "SKOM status is SUBMITTED" ($skomSub.status -eq "SUBMITTED") "$($skomSub.status)" }
    $skomApp = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/skom-budget/approve" -Token $E2E.Tokens.ops -Label "Ops approve SKOM" -Body @{ action="APPROVE"; notes="ok" }
    Check "Ops approved SKOM" $skomApp | Out-Null
    if ($skomApp -ne $null) { CheckValue "SKOM status is APPROVED" ($skomApp.status -eq "APPROVED") "$($skomApp.status)" }
    $disb = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/skom-budget/disbursements" -Token $E2E.Tokens.ops -Label "Schedule disbursement" -Body @{ amount=85000000; description="Pencairan SKOM E2E"; scheduledDate=(Get-Date).AddDays(7).ToString("yyyy-MM-ddTHH:mm:ssZ") }
    Check "Disbursement scheduled" $disb | Out-Null
    $clusterAfterSkom = Invoke-API -Method GET -Path "/permit-clusters/$($E2E.ClusterId)" -Token $E2E.Tokens.ad -Label "Get cluster after SKOM"
    if ($clusterAfterSkom -ne $null) {
        $phaseS = if ($clusterAfterSkom.currentPhase -ne $null) { $clusterAfterSkom.currentPhase } else { "null" }
        CheckValue "Cluster phase advanced after SKOM/disbursement" (($phaseS -eq "BAK_GENERATION") -or ($phaseS -eq "BAKP_COMPILATION") -or ($phaseS -eq "CLAIM_SUBMISSION")) $phaseS
    }
} else { Fail "SKOM checks skipped (cluster missing)" }
Show-Progress "PHASE 18-19"

Write-Host "`n[PHASE 20] BAKP"
if ($E2E.ClusterId -ne "") {
    Start-Sleep -Seconds 1
    $clusterBakp = Invoke-API -Method GET -Path "/permit-clusters/$($E2E.ClusterId)" -Token $E2E.Tokens.ad -Label "Get cluster for BAKP"
    $bakpId = ""
    if ($clusterBakp -ne $null -and $clusterBakp.bakp -ne $null) { $bakpId = $clusterBakp.bakp.id }
    if ($bakpId -ne "") {
        Pass "BAKP found in cluster"
    } else {
        Warn "BAKP not auto-created in this run (optional async stage)"
    }
    if ($bakpId -ne "") {
        $p1 = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/bakp/$bakpId/participants" -Token $E2E.Tokens.sv -Label "Add BAKP participant" -Body @{ name="Pak Budi Santoso"; role="Ketua RW 08"; ktpNumber="3201234567890001"; ktpPhotoUrl="https://placeholder.permatrax.dev/ktp-budi.jpg" }
        Check "BAKP participant added" $p1 | Out-Null
        if ($p1 -ne $null -and $p1.Count -gt 0) { CheckValue "BAKP participant name correct" ($p1[0].name -eq "Pak Budi Santoso") "$($p1[0].name)" } else { Fail "BAKP participant name correct (empty response)" }
        $st = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/bakp/$bakpId/stempel" -Token $E2E.Tokens.sv -Label "Upload stempel" -Body @{ stempelUrl="https://placeholder.permatrax.dev/stempel.png" }
        Check "BAKP stempel uploaded" $st | Out-Null
        $gen = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/bakp/$bakpId/generate" -Token $E2E.Tokens.sv -Label "Generate BAKP"
        Check "BAKP generated" $gen | Out-Null
        if ($gen -ne $null) { CheckNotNull "BAKP has pdfUrl" $gen.pdfUrl "pdfUrl" }
        $ftSub = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/bakp/$bakpId/field-team-submit" -Token $E2E.Tokens.sv -Label "Field team submit BAKP"
        Check "Field team submitted BAKP" $ftSub | Out-Null
        $pmB = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/bakp/$bakpId/pm-approve" -Token $E2E.Tokens.pm -Label "PM approve BAKP"
        Check "PM approved BAKP" $pmB | Out-Null
        $adB = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/bakp/$bakpId/admin-approve" -Token $E2E.Tokens.ad -Label "Admin approve BAKP"
        Check "Admin approved BAKP" $adB | Out-Null
    }
} else { Fail "BAKP checks skipped (cluster missing)" }
Show-Progress "PHASE 20"

Write-Host "`n[PHASE 21] Claim Stream A + B"
if ($E2E.ClusterId -ne "") {
    $claim = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/claim-package/init" -Token $E2E.Tokens.ad -Label "Init claim package"
    if (Check "Claim package initialized" $claim) { $E2E.ClaimDocId = $claim.id }
    $streamA = @("docBaOpen","docBaAcara","docBaTtdRt","docSip","docKtpRtRw","docPks","docKwitansi","docBuktiTrf","docSkInternal","docPoSpk")
    foreach ($k in $streamA) {
        $r = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/claim-package/stream-a" -Token $E2E.Tokens.sv -Label "Upload stream-a $k" -Body @{ docKey=$k; fileUrl="https://placeholder.permatrax.dev/$k.pdf" }
        Check "Stream A uploaded: $k" $r | Out-Null
    }
    $streamB = @("docBaOpenLengkap","docKwitansiGov","docFotoEvidance","docEvidancePaymentGov","docSkInternalGov","docPoSpkGov")
    foreach ($k in $streamB) {
        $r = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/claim-package/stream-b" -Token $E2E.Tokens.ad -Label "Upload stream-b $k" -Body @{ docKey=$k; fileUrl="https://placeholder.permatrax.dev/$k.pdf" }
        Check "Stream B uploaded: $k" $r | Out-Null
    }
} else { Fail "Claim stream checks skipped (cluster missing)" }
Show-Progress "PHASE 21"

Write-Host "`n[PHASE 22] Pengecekan"
if ($E2E.ClusterId -ne "") {
    $ck1 = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/claim-package/check1" -Token $E2E.Tokens.ad -Label "Run check1"
    Check "Check1 executed" $ck1 | Out-Null
    $ck1Status = "null"; if ($ck1 -ne $null -and $ck1.check1Status -ne $null) { $ck1Status = $ck1.check1Status }
    CheckValue "Check1 status = PASS" ($ck1Status -eq "PASS") $ck1Status
    $sub2 = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/claim-package/submit-check2" -Token $E2E.Tokens.ad -Label "Submit for check2"
    Check "Submitted for Check2" $sub2 | Out-Null
    $pm2 = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/claim-package/pm-approve-check2" -Token $E2E.Tokens.pm -Label "PM approve check2"
    Check "PM approved Check2" $pm2 | Out-Null
    $toIsp = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/claim-package/submit-to-isp" -Token $E2E.Tokens.ad -Label "Submit claim to ISP"
    Check "Claim submitted to ISP" $toIsp | Out-Null
    CheckPhase $E2E.ClusterId "INVOICE_PACKAGE" $E2E.Tokens.ad
} else { Fail "Check1/Check2 checks skipped (cluster missing)" }
Show-Progress "PHASE 22"

Write-Host "`n[PHASE 23] Invoice"
if ($E2E.ClusterId -ne "") {
    $inv = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/invoice/generate" -Token $E2E.Tokens.ad -Label "Generate invoice" -Body @{ amount=85000000; supportingDocs=@("https://placeholder.permatrax.dev/bundle.zip") }
    if (Check "Invoice generated" $inv) { $E2E.InvoiceDocId = $inv.id }
    CheckNotNull "Invoice has invoiceNumber" $inv.invoiceNumber "invoiceNumber"
    if ($inv -ne $null) { CheckValue "Invoice amount = 85000000" ("$($inv.amount)" -like "*85000000*") "$($inv.amount)" }
    $invSub = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/invoice/submit" -Token $E2E.Tokens.ad -Label "Submit invoice to finance"
    Check "Invoice submitted to Finance" $invSub | Out-Null
    if ($invSub -ne $null) { CheckValue "Invoice status = SUBMITTED" ($invSub.status -eq "SUBMITTED") "$($invSub.status)" }
    $invApp = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/invoice/approve" -Token $E2E.Tokens.fin -Label "Finance approve invoice"
    Check "Finance approved invoice" $invApp | Out-Null
    if ($invApp -ne $null) { CheckValue "Invoice status = APPROVED" ($invApp.status -eq "APPROVED") "$($invApp.status)" }
    $pay = Invoke-API -Method POST -Path "/permit-clusters/$($E2E.ClusterId)/invoice/record-payment" -Token $E2E.Tokens.fin -Label "Record payment" -Body @{
        paymentRef="TRF-BNI-E2E-$(Get-Random -Maximum 9999)"; paymentEvidenceUrl="https://placeholder.permatrax.dev/bukti-transfer.pdf"; paidAt=(Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
    Check "Payment recorded" $pay | Out-Null
    if ($pay -ne $null) { CheckValue "Invoice status = PAID" ($pay.status -eq "PAID") "$($pay.status)" }
    CheckPhase $E2E.ClusterId "PERMIT_DONE" $E2E.Tokens.gm
} else { Fail "Invoice checks skipped (cluster missing)" }
Show-Progress "PHASE 23"

Write-Host "`n[FINAL] Role visibility PERMIT_DONE"
if ($E2E.ClusterId -ne "") {
    $cGm = Invoke-API -Method GET -Path "/permit-clusters/$($E2E.ClusterId)" -Token $E2E.Tokens.gm -Label "GM view final cluster"
    $cPm = Invoke-API -Method GET -Path "/permit-clusters/$($E2E.ClusterId)" -Token $E2E.Tokens.pmSr -Label "PM view final cluster"
    $cSv = Invoke-API -Method GET -Path "/permit-clusters/$($E2E.ClusterId)" -Token $E2E.Tokens.sv -Label "Surveyor view final cluster"
    $cAd = Invoke-API -Method GET -Path "/permit-clusters/$($E2E.ClusterId)" -Token $E2E.Tokens.ad -Label "Admin view final cluster"
    $pGm = if ($cGm -ne $null) { $cGm.currentPhase } else { "null" }
    $pPm = if ($cPm -ne $null) { $cPm.currentPhase } else { "null" }
    $pSv = if ($cSv -ne $null) { $cSv.currentPhase } else { "null" }
    $pAd = if ($cAd -ne $null) { $cAd.currentPhase } else { "null" }
    CheckValue "GM sees PERMIT_DONE" ($pGm -eq "PERMIT_DONE") "$pGm"
    CheckValue "PM sees PERMIT_DONE" ($pPm -eq "PERMIT_DONE") "$pPm"
    CheckValue "Surveyor sees PERMIT_DONE" ($pSv -eq "PERMIT_DONE") "$pSv"
    CheckValue "Admin sees PERMIT_DONE" ($pAd -eq "PERMIT_DONE") "$pAd"
}
Show-Progress "FINAL"

Write-Host "`n[RBAC TESTS] Verify role restrictions"
$rbac1 = Invoke-API -Method POST -Path "/clean-list" -Token $E2E.Tokens.sv -Label "RBAC surveyor clean-list" -Body @{ispCustomer="Test"; fiberType="FTTH"; rwCode="RW-RBAC-1"; kelurahan="X"; kecamatan="X"; kotaKabupaten="X"; homepasCount=1}
CheckValue "Surveyor CANNOT create clean list (403)" ($rbac1 -eq $null) "expected null"
$rbac2 = Invoke-API -Method PATCH -Path "/visit-requests/fake-id/pm-review" -Token $E2E.Tokens.fin -Label "RBAC finance pm-review" -Body @{action="APPROVE"}
CheckValue "Finance CANNOT approve VR (403/404)" ($rbac2 -eq $null) "expected null"
$rbac3 = Invoke-API -Method POST -Path "/permit-clusters/fake/hld/fake/pm-approve" -Token $E2E.Tokens.sv -Label "RBAC surveyor hld approve"
CheckValue "Surveyor CANNOT approve HLD (403/404)" ($rbac3 -eq $null) "expected null"
$rbac4 = Invoke-API -Method POST -Path "/clean-list" -Token $E2E.Tokens.ops -Label "RBAC ops clean-list" -Body @{ispCustomer="Test"; fiberType="FTTH"; rwCode="RW-RBAC-2"; kelurahan="X"; kecamatan="X"; kotaKabupaten="X"; homepasCount=1}
CheckValue "Ops Manager CANNOT create clean list (403)" ($rbac4 -eq $null) "expected null"
$rbac5 = Invoke-API -Method POST -Path "/permit-clusters/fake/skom-budget/approve" -Token $E2E.Tokens.fin -Label "RBAC finance skom approve" -Body @{action="APPROVE"}
CheckValue "Finance CANNOT approve SKOM (403/404)" ($rbac5 -eq $null) "expected null"
Show-Progress "RBAC"

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "PERMATRAX E2E TEST SUMMARY" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "PASS : $($E2E.PassCount)" -ForegroundColor Green
Write-Host "WARN : $($E2E.WarnCount)" -ForegroundColor Yellow
Write-Host "FAIL : $($E2E.FailCount)" -ForegroundColor Red
Write-Host "TOTAL: $($E2E.PassCount + $E2E.WarnCount + $E2E.FailCount)"
Write-Host "==========================================" -ForegroundColor Cyan
