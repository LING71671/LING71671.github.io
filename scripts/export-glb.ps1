# 一键资产管线：Blender 无头建模导出 + gltf-transform 压缩
# 用法: pwsh scripts/export-glb.ps1
$ErrorActionPreference = 'Stop'
$blender = 'E:\Blender\blender.exe'
$root = Split-Path $PSScriptRoot -Parent

& $blender --background --factory-startup --python (Join-Path $PSScriptRoot 'blender\build_desk.py') -- (Join-Path $root 'public\models')
if ($LASTEXITCODE -ne 0) { throw "Blender 导出失败 (exit $LASTEXITCODE)" }

node (Join-Path $PSScriptRoot 'optimize-gltf.mjs') (Join-Path $root 'public\models')
if ($LASTEXITCODE -ne 0) { throw "gltf-transform 压缩失败 (exit $LASTEXITCODE)" }

Write-Host '资产管线完成: public/models/clock.glb, desk.glb'
