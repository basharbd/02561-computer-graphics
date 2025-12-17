"use strict";

function addPointAsQuad(dst, p, sizeNdcX, sizeNdcY) {
  const hx = sizeNdcX * 0.5;
  const hy = sizeNdcY * 0.5;

  const x0 = p[0] - hx, x1 = p[0] + hx;
  const y0 = p[1] - hy, y1 = p[1] + hy;

  dst.push(
    vec2(x0, y0), vec2(x1, y0), vec2(x0, y1),
    vec2(x0, y1), vec2(x1, y0), vec2(x1, y1)
  );
}

function mouseToNDC(ev, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((ev.clientY - rect.top) / rect.height) * 2;
  return vec2(x, y);
}

async function main() {
  if (!navigator.gpu) throw new Error("WebGPU not ensure supported.");

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");
  const device = await adapter.requestDevice();

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  // -------- UI --------
  const colorSelect = document.getElementById("color-select");
  const clearSelect = document.getElementById("clear-select");
  const clearBtn = document.getElementById("clear-button");

  const colorValues = [
    vec4(1.0, 1.0, 1.0, 1.0),         // White
    vec4(0.0, 0.0, 0.0, 1.0),         // Black
    vec4(1.0, 0.0, 0.0, 1.0),         // Red
    vec4(0.0, 1.0, 0.0, 1.0),         // Green
    vec4(0.0, 0.0, 1.0, 1.0),         // Blue
    vec4(1.0, 1.0, 0.0, 1.0),         // Yellow
    vec4(1.0, 0.647, 0.0, 1.0),       // Orange
    vec4(0.3921, 0.5843, 0.9294, 1.0) // Cornflower
  ];

  // -------- Point setup --------
  const vertsPerPoint = 6;
  const maxPoints = 100;
  let pointCount = 0;

  const pointSizePx = 20;
  const sizeNdcX = (pointSizePx / canvas.width) * 2.0;
  const sizeNdcY = (pointSizePx / canvas.height) * 2.0;

  let positions = [];
  let colors = [];

  // -------- GPU buffers --------
  const positionBuffer = device.createBuffer({
    size: sizeof["vec2"] * vertsPerPoint * maxPoints,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const colorBuffer = device.createBuffer({
    size: sizeof["vec4"] * vertsPerPoint * maxPoints,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const positionLayout = {
    arrayStride: sizeof["vec2"],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  const colorLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }],
  };

  // -------- Shader & pipeline --------
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then(r => r.text());
  const shader = device.createShaderModule({ code: wgslCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "main_vs", buffers: [positionLayout, colorLayout] },
    fragment: { module: shader, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  let bgColor = colorValues[Number(clearSelect.value)];

  function render() {
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
    device.queue.writeBuffer(colorBuffer, 0, flatten(colors));

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: bgColor[0], g: bgColor[1], b: bgColor[2], a: bgColor[3] },
      }],
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, colorBuffer);
    pass.draw(pointCount * vertsPerPoint);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  // -------- Events --------
  canvas.addEventListener("click", (ev) => {
    if (pointCount >= maxPoints) return;

    const p = mouseToNDC(ev, canvas);
    addPointAsQuad(positions, p, sizeNdcX, sizeNdcY);

    const c = colorValues[Number(colorSelect.value)];
    colors.push(...Array(vertsPerPoint).fill(c));

    pointCount++;
    render();
  });

  clearBtn.addEventListener("click", () => {
    positions = [];
    colors = [];          
    pointCount = 0;
    bgColor = colorValues[Number(clearSelect.value)];
    render();
  });

  clearSelect.addEventListener("change", () => {
    // shapes
    bgColor = colorValues[Number(clearSelect.value)];
    render();
  });

  render();
}

window.onload = function () { main(); };
