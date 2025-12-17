"use strict";

function addSquare(vertices, cx, cy, sizePx, canvasWidth, canvasHeight) {
  // Convert pixel size -> NDC size
  // NDC ranges from -1..1 => width = 2
  const halfW = sizePx / canvasWidth;   // (sizePx/2) * (2/canvasWidth) = sizePx/canvasWidth
  const halfH = sizePx / canvasHeight;

  const x0 = cx - halfW, x1 = cx + halfW;
  const y0 = cy - halfH, y1 = cy + halfH;

  // Two triangles (6 vertices), each vertex is (x,y)
  vertices.push(
    x0, y0,  x1, y0,  x0, y1,
    x0, y1,  x1, y0,  x1, y1
  );
}

async function main() {
  if (!navigator.gpu) {
    throw new Error("WebGPU not supported in this browser.");
  }

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");

  const device = await adapter.requestDevice();

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "opaque",
  });

  // ---- Build vertex data: 3 black squares (20px x 20px) ----
  const sizePx = 20;
  const verts = [];

  // Updated coordinates to match the provided image:
  // 1. Center (0,0)
  addSquare(verts,  0.0,  0.0, sizePx, canvas.width, canvas.height);
  // 2. Right Edge (1,0)
  addSquare(verts,  1.0,  0.0, sizePx, canvas.width, canvas.height);
  // 3. Top Right Corner (1,1)
  addSquare(verts,  1.0,  1.0, sizePx, canvas.width, canvas.height);

  const vertexData = new Float32Array(verts);
  const vertexCount = vertexData.length / 2;

  const positionBuffer = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, vertexData);

  const positionBufferLayout = {
    arrayStride: 2 * 4, // 2 floats * 4 bytes
    attributes: [
      {
        shaderLocation: 0,
        offset: 0,
        format: "float32x2",
      },
    ],
  };

  // ---- Load WGSL code from shader.wgsl ----
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then((r) => r.text());

  const shaderModule = device.createShaderModule({ code: wgslCode });

  // ---- Create pipeline ----
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [positionBufferLayout],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "main_fs",
      targets: [{ format }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });

  // ---- Render ----
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 }, // Cornflower blue background
      },
    ],
  });

  pass.setPipeline(pipeline);
  pass.setVertexBuffer(0, positionBuffer);
  pass.draw(vertexCount);
  pass.end();

  device.queue.submit([encoder.finish()]);
}

window.addEventListener("load", () => {
  main().catch((err) => console.error(err));
});