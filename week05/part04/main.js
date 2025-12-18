"use strict";

async function main() {
  if (!navigator.gpu) throw new Error("WebGPU not supported.");

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  // Load OBJ (Suzanne)
  const objFilename = "../assets/suzanne.obj";
  const obj = await readOBJFile(objFilename, 1.0, true);

  // UI elements
  const emittedRadianceSlider = document.getElementById("emitted-radiance");
  const ambientRadianceSlider = document.getElementById("ambient-radiance");
  const diffuseSlider = document.getElementById("diffuse");
  const specularSlider = document.getElementById("specular");
  const shininessSlider = document.getElementById("shininess");

  // UI state
  let Le = parseFloat(emittedRadianceSlider.value);
  let La = parseFloat(ambientRadianceSlider.value);
  let kd = parseFloat(diffuseSlider.value);
  let ks = parseFloat(specularSlider.value);
  let s = parseFloat(shininessSlider.value);

  // Re-render on slider changes
  const request = () => requestAnimationFrame(render);
  emittedRadianceSlider.oninput = () => { Le = parseFloat(emittedRadianceSlider.value); request(); };
  ambientRadianceSlider.oninput = () => { La = parseFloat(ambientRadianceSlider.value); request(); };
  diffuseSlider.oninput = () => { kd = parseFloat(diffuseSlider.value); request(); };
  specularSlider.oninput = () => { ks = parseFloat(specularSlider.value); request(); };
  shininessSlider.oninput = () => { s = parseFloat(shininessSlider.value); request(); };

  // Animation toggle
  let shouldAnimate = false;
  let lastTime = performance.now();
  document.getElementById("toggle-animate").onclick = () => {
    shouldAnimate = !shouldAnimate;
    if (shouldAnimate) {
      lastTime = performance.now();
      requestAnimationFrame(animate);
    }
  };

  // CPU-side mesh data
  const positions = obj.vertices; // vec4[]
  const colors = obj.colors;      // vec4[]
  const normals = obj.normals;    // vec4[]
  const indices = obj.indices;    // Uint32Array

  // GPU buffers: positions
  const positionBuffer = device.createBuffer({
    size: sizeof["vec4"] * positions.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

  // GPU buffers: colors
  const colorBuffer = device.createBuffer({
    size: sizeof["vec4"] * colors.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(colorBuffer, 0, flatten(colors));

  // GPU buffers: normals
  const normalBuffer = device.createBuffer({
    size: sizeof["vec4"] * normals.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(normalBuffer, 0, flatten(normals));

  // GPU buffers: indices
  const indicesBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indicesBuffer, 0, indices);

  // Vertex buffer layouts
  const positionBufferLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }],
  };
  const colorBufferLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ format: "float32x4", offset: 0, shaderLocation: 1 }],
  };
  const normalBufferLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ format: "float32x4", offset: 0, shaderLocation: 2 }],
  };

  // Uniform buffer (manual packing)
  const uniformBuffer = device.createBuffer({
    size: 60 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Depth remap matrix (clip z -> [0,1])
  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  // Model transform
  const M = mult(translate(0, -0.6, 0), scalem(0.9, 0.9, 0.9));

  // Projection transform
  let projection = perspective(45, canvas.width / canvas.height, 0.1, 100);
  projection = mult(Mst, projection);

  // Camera orbit parameters
  const r = 4.0;
  let angle = 0.0;

  // Point light in world space
  const lightWorld = vec3(2.5, 2.5, 2.5);

  // Load WGSL and create pipeline
  const wgslFile = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslFile, { cache: "reload" }).then((r) => r.text());
  const wgsl = device.createShaderModule({ code: wgslCode });

  const msaaCount = 4;

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: wgsl,
      entryPoint: "main_vs",
      buffers: [positionBufferLayout, colorBufferLayout, normalBufferLayout],
    },
    fragment: {
      module: wgsl,
      entryPoint: "main_fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "back" },
    multisample: { count: msaaCount },
    depthStencil: { depthWriteEnabled: true, depthCompare: "less", format: "depth24plus" },
  });

  // MSAA + depth attachments
  const msaaTexture = device.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format: canvasFormat,
    sampleCount: msaaCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const depthTexture = device.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format: "depth24plus",
    sampleCount: msaaCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Bind group: uniforms only
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // Background color
  const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0);

  function render() {
    // Build view matrix from orbit camera
    const eyeWorld = vec3(r * Math.sin(angle), 0.6, r * Math.cos(angle));
    const V = lookAt(eyeWorld, vec3(0, 0, 0), vec3(0, 1, 0));

    // MV/MVP for shading
    const MV = mult(V, M);
    const MVP = mult(projection, MV);

    // Normal matrix (inverse-transpose of MV)
    const normalMat = transpose(inverse(MV));

    // Transform light into view space
    const lightView4 = mult(V, vec4(lightWorld[0], lightWorld[1], lightWorld[2], 1.0));
    const lightView = vec4(lightView4[0], lightView4[1], lightView4[2], 1.0);

    // Upload uniforms (byte offsets)
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(flatten(lightView)));
    device.queue.writeBuffer(uniformBuffer, 16, new Float32Array([Le, La, kd, ks]));
    device.queue.writeBuffer(uniformBuffer, 32, new Float32Array([s, 0, 0, 0]));
    device.queue.writeBuffer(uniformBuffer, 48, new Float32Array(flatten(MVP)));
    device.queue.writeBuffer(uniformBuffer, 112, new Float32Array(flatten(MV)));
    device.queue.writeBuffer(uniformBuffer, 176, new Float32Array(flatten(normalMat)));

    // Render pass
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: msaaTexture.createView(),
        resolveTarget: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: bgcolor[0], g: bgcolor[1], b: bgcolor[2], a: bgcolor[3] },
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1.0,
        depthStoreOp: "store",
      },
    });

    // Draw mesh
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setIndexBuffer(indicesBuffer, "uint32");
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, colorBuffer);
    pass.setVertexBuffer(2, normalBuffer);
    pass.drawIndexed(indices.length);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  function animate(ts) {
    // Update orbit angle based on time delta
    angle += (ts - lastTime) * 0.0018;
    lastTime = ts;

    render();
    if (shouldAnimate) requestAnimationFrame(animate);
  }

  // First frame
  render();
}

window.onload = () => main();
