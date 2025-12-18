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

  // Load OBJ (relative to this part folder)
  const obj_filename = "../assets/suzanne.obj";
  const obj = await readOBJFile(obj_filename, 1.0, true);

  // UI elements
  const emittedRadianceSlider = document.getElementById("emitted-radiance");
  const ambientRadianceSlider = document.getElementById("ambient-radiance");
  const diffuseSlider = document.getElementById("diffuse");
  const specularSlider = document.getElementById("specular");
  const shininessSlider = document.getElementById("shininess");

  // UI state
  let emittedRadiance = parseFloat(emittedRadianceSlider.value);
  let ambientRadiance = parseFloat(ambientRadianceSlider.value);
  let diffuse = parseFloat(diffuseSlider.value);
  let specular = parseFloat(specularSlider.value);
  let shininess = parseFloat(shininessSlider.value);

  // Re-render on parameter change
  const requestRender = () => requestAnimationFrame(render);
  emittedRadianceSlider.oninput = () => { emittedRadiance = parseFloat(emittedRadianceSlider.value); requestRender(); };
  ambientRadianceSlider.oninput = () => { ambientRadiance = parseFloat(ambientRadianceSlider.value); requestRender(); };
  diffuseSlider.oninput = () => { diffuse = parseFloat(diffuseSlider.value); requestRender(); };
  specularSlider.oninput = () => { specular = parseFloat(specularSlider.value); requestRender(); };
  shininessSlider.oninput = () => { shininess = parseFloat(shininessSlider.value); requestRender(); };

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
    size: 4 * indices.length,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indicesBuffer, 0, indices);

  // Uniform buffer (matches shader packing)
  const uniformBuffer = device.createBuffer({
    size: 4 * 8 + sizeof["mat4"],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Vertex buffer layouts
  const positionLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }],
  };
  const colorLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ format: "float32x4", offset: 0, shaderLocation: 1 }],
  };
  const normalLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ format: "float32x4", offset: 0, shaderLocation: 2 }],
  };

  // Clip-space depth fix (OpenGL [-1,1] -> WebGPU [0,1])
  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  // Model transform
  const M = mult(translate(0, -0.5, 0), scalem(0.8, 0.8, 0.8));

  // Projection transform
  let projection = perspective(45, canvas.width / canvas.height, 0.1, 100);
  projection = mult(Mst, projection);

  // Orbit camera parameters
  const r = 4;
  let angle = 0;

  // Load WGSL and create pipeline
  const wgslfile = document.getElementById("wgsl").src;
  const wgslcode = await fetch(wgslfile, { cache: "reload" }).then((r) => r.text());
  const shader = device.createShaderModule({ code: wgslcode });

  const msaaCount = 4;

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shader,
      entryPoint: "main_vs",
      buffers: [positionLayout, colorLayout, normalLayout],
    },
    fragment: {
      module: shader,
      entryPoint: "main_fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: {
      topology: "triangle-list",
      frontFace: "ccw",
      cullMode: "back",
    },
    multisample: { count: msaaCount },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: "less",
      format: "depth24plus",
    },
  });

  // MSAA + depth targets
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

  // Background clear color
  const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0);

  function render() {
    // Camera view matrix
    const eye = vec3(r * Math.sin(angle), 0, r * Math.cos(angle));
    const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));

    // Final MVP
    const mvp = mult(projection, mult(V, M));

    // Pack uniforms (eye + lighting params)
    const uniformFloats = new Float32Array([
      ...flatten(eye),
      emittedRadiance,
      ambientRadiance,
      diffuse,
      specular,
      shininess,
    ]);

    // Upload uniforms and MVP
    device.queue.writeBuffer(uniformBuffer, 0, uniformFloats);
    device.queue.writeBuffer(uniformBuffer, 4 * 8, flatten(mvp));

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
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, colorBuffer);
    pass.setVertexBuffer(2, normalBuffer);
    pass.setIndexBuffer(indicesBuffer, "uint32");
    pass.drawIndexed(indices.length);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  function animate(ts) {
    // Advance orbit angle using frame time
    angle += (ts - lastTime) * 0.0025;
    lastTime = ts;

    render();
    if (shouldAnimate) requestAnimationFrame(animate);
  }

  // First frame
  render();
}

window.onload = () => main();
