"use strict";

function addSquare(vertices, cx, cy, sizePx, canvasWidth, canvasHeight) {
  // Convert square size in pixels into half-size in NDC units
  // (NDC spans [-1,1] so full width is 2; this formula matches the intended scaling)
  const halfW = sizePx / canvasWidth;
  const halfH = sizePx / canvasHeight;

  const x0 = cx - halfW, x1 = cx + halfW;
  const y0 = cy - halfH, y1 = cy + halfH;

  // Two triangles (6 vertices) to form one square
  vertices.push(
    x0, y0,  x1, y0,  x0, y1,
    x0, y1,  x1, y0,  x1, y1
  );
}

async function main() {
  // WebGPU availability check
  if (!navigator.gpu) {
    throw new Error("WebGPU not supported in this browser.");
  }

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");

  // Get GPU device
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");
  const device = await adapter.requestDevice();

  // Configure swap chain
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "opaque",
  });

  // Build vertex data: three squares made from triangles
  const sizePx = 20;
  const verts = [];

  // Square centers in NDC coordinates
  addSquare(verts,  0.0,  0.0, sizePx, canvas.width, canvas.height); // center
  addSquare(verts,  1.0,  0.0, sizePx, canvas.width, canvas.height); // right
  addSquare(verts,  1.0,  1.0, sizePx, canvas.width, canvas.height); // top-right

  const vertexData = new Float32Array(verts);
  const vertexCount = vertexData.length / 2; // 2 floats per vertex (x,y)

  // Upload vertex positions
  const positionBuffer = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, vertexData);

  // Vertex buffer layout (matches shader @location(0) vec2f)
  const positionBufferLayout = {
    arrayStride: 2 * 4,
    attributes: [
      {
        shaderLocation: 0,
        offset: 0,
        format: "float32x2",
      },
    ],
  };

  // Load WGSL from <script id="wgsl" src="shader.wgsl">
  const wgslUrl = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslUrl, { cache: "reload" }).then((r) => r.text());
  const shaderModule = device.createShaderModule({ code: wgslCode });

  // Render pipeline: position-only vertex input + solid color fragment
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

  // Encode one render pass: clear + draw all vertices
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 }, // background
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
