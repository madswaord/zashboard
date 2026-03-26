# map-assets

本目录用于整理可独立抽离的世界地图资源资产，目标是后续可单独建仓复用。

## 目录说明

- `sources/`：原始底图输入
- `generated/`：生成/尝试过的输出底图
- `build_atlantic_world.py`：当前的大西洋 seam 切割实验脚本
- `docs/README.md`：说明文件

## 当前文件

### 原始底图
- `sources/world.standard.geojson`：标准 world geojson 输入

### 生成结果
- `generated/world.pacific.geojson`：Pacific-centered 尝试版本
- `generated/world.atlantic-shift.geojson`：简单经度平移版（已证明不可作为最终版本）
- `generated/world.atlantic-seam.geojson`：Atlantic seam 切割实验版（当前最新实验结果）

## 备注

当前这些资源仍处于实验阶段，尚未确认哪一版可作为最终可复用版本。
