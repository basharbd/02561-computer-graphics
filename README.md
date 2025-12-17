

# 02561 Computer Graphics (DTU) — Lab Journal + Project (WebGPU)

**Course:** 02561 Computer Graphics, Technical University of Denmark (DTU), Fall 2025

This repository contains my **WebGPU-based lab journal** (worksheets) and my **minor project** for DTU 02561.

## 🌐 Live Page 




- **Lab Journal (GitHub Pages):** [https://basharbd.github.io/02561-computer-graphics/](https://basharbd.github.io/02561-computer-graphics/)
- **Project Page (Planar Reflector):** [https://basharbd.github.io/02561-computer-graphics/project/](https://basharbd.github.io/02561-computer-graphics/project/)

> The site is designed to run directly in the browser via GitHub Pages (no extra build steps).

---

## 📁 Repository Structure

```text
.
├── index.html                # Main wrapper index (links to weeks + project)
├── common/                   # Shared CSS + JS utilities (MV.js, OBJ parsers, mipmap helper, etc.)
├── week01/ ... week10/       # Lab journal weeks (each part has index.html + main.js + shader.wgsl)
└── project/
    └── planar_reflector/
        ├── part01/
        ├── part02/
        ├── part03/
        └── part04/
```

Each lab part follows the same template:

* `index.html` (UI + layout)
* `main.js` (WebGPU setup + rendering)
* `shader.wgsl` (WGSL shaders)

---

## ✅ Minor Project: Planar Reflector in WebGPU

**Title:** *Planar Reflector in WebGPU — Blending, Stencil Masking, and Oblique Near-Plane Clipping*

The project implements a convincing planar reflection using classic rasterization techniques (no ray tracing):

* **Reflection transform** (mirrored teapot via model reflection matrix)
* **Alpha blending** (semi-transparent textured ground to reveal reflection)
* **Stencil masking** (clips reflection to only appear inside the ground footprint)
* **Oblique near-plane clipping** (prevents reflecting geometry behind the reflector plane)

---

## ▶️ How to Run Locally

You can run everything locally with a simple static server:

```bash
python3 -m http.server
```

Then open:

* `http://localhost:8000/`

> WebGPU requires a supported browser (Chrome/Edge recommended) with WebGPU enabled by default.

---

## 🧪 Tested Environment

* Browser: Chrome (WebGPU enabled by default)
* Platform: macOS / Windows (should work similarly on Linux)
* Rendering: WebGPU + WGSL

---

## 📄 Report

The project report is included in the submission package (PDF).
It follows the required structure: **Introduction, Method, Implementation, Results, Discussion**, and includes:

* Link to **Lab Journal**
* Link to **Project implementation**
* Figures placed under the corresponding subsections


