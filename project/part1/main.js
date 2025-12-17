"use strict";

function setupInputListeners(onchange) {
  const ids = [
    "emitted-radiance", "ambient-radiance", "diffuse",
    "specular", "shininess"
  ];
  for (const id of ids) document.getElementById(id).oninput = onchange;
}

function getOptions() {
  return {
    Le: parseFloat(document.getElementById("emitted-radiance").value),
    La: parseFloat(document.getElementById("ambient-radiance").value),
    kd: parseFloat(document.getElementById("diffuse").value),
    ks: parseFloat(document.getElementById("specular").value),
    shin: parseFloat(document.getElementById("shininess").value),
  };
}

// Reflection about plane y = -1:
// R = T(0,-1,0) * S(1,-1,1) * T(0, +1, 0)
function reflectionYMinus1() {
  return mult(translate(0, -1, 0), mult(scalem(1, -1, 1), translate(0, 1, 0)));
}

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const msaaCount = 4;

  const msaaTex = device.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format,
    sampleCount: msaaCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const depthTex = device.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format: "depth24plus",
    sampleCount: msaaCount,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // --- Shader
  const wgslURL = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslURL, { cache: "reload" }).then(r => r.text());
  const shader = device.createShaderModule({ code: wgslCode });

  // --- Load teapot OBJ
  const obj = await readOBJFile("../textures/teapot.obj", 1, true);

  const teapotPos = obj.vertices;
  const teapotNor = obj.normals;
  const teapotIdx = obj.indices;

  const teapotPosBuf = device.createBuffer({
    size: sizeof["vec4"] * teapotPos.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(teapotPosBuf, 0, flatten(teapotPos));

  const teapotNorBuf = device.createBuffer({
    size: sizeof["vec4"] * teapotNor.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(teapotNorBuf, 0, flatten(teapotNor));

  const teapotIdxBuf = device.createBuffer({
    size: teapotIdx.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(teapotIdxBuf, 0, teapotIdx);

  const teapotVBLayouts = [
    { arrayStride: sizeof["vec4"], attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] },
    { arrayStride: sizeof["vec4"], attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }] },
  ];

  // Teapot uniforms: 3 mat4 + 3 vec4 = 240 bytes
  const teapotUniformSize = sizeof["mat4"] * 3 + sizeof["vec4"] * 3;

  const uboA = device.createBuffer({ size: teapotUniformSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const uboB = device.createBuffer({ size: teapotUniformSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  // --- Pipeline
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shader, entryPoint: "vs_teapot", buffers: teapotVBLayouts },
    fragment: { module: shader, entryPoint: "fs_teapot", targets: [{ format }] },
    primitive: {
      topology: "triangle-list",
      cullMode: "none", // reflection flips winding, so we disable culling
      frontFace: "ccw",
    },
    multisample: { count: msaaCount },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });

  const bgA = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uboA } }],
  });

  const bgB = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uboB } }],
  });

  // --- Camera
  const eye = vec3(0, 0, 1);
  const at  = vec3(0, 0, -3);
  const up  = vec3(0, 1, 0);

  const depthFix = mat4(
    1, 0,   0,   0,
    0, 1,   0,   0,
    0, 0, 0.5, 0.5,
    0, 0,   0,   1
  );

  // --- Scene
  const R = reflectionYMinus1();
  const lightWorld = vec3(2.0, 2.0, -2.0);

  function writeTeapotUniforms(buf, mvp, model, normalMat, eye3, light3, opts) {
    device.queue.writeBuffer(buf, 0,                 flatten(mvp));
    device.queue.writeBuffer(buf, sizeof["mat4"],    flatten(model));
    device.queue.writeBuffer(buf, sizeof["mat4"]*2,  flatten(normalMat));

    const eye4   = new Float32Array([eye3[0], eye3[1], eye3[2], 1.0]);
    const light4 = new Float32Array([light3[0], light3[1], light3[2], opts.Le]);
    const params = new Float32Array([opts.La, opts.kd, opts.ks, opts.shin]);

    device.queue.writeBuffer(buf, sizeof["mat4"]*3,                   eye4);
    device.queue.writeBuffer(buf, sizeof["mat4"]*3 + sizeof["vec4"],  light4);
    device.queue.writeBuffer(buf, sizeof["mat4"]*3 + sizeof["vec4"]*2, params);
  }

  function render() {
    const opts = getOptions();

    const aspect = canvas.width / canvas.height;
    const P = mult(depthFix, perspective(65, aspect, 0.2, 50));
    const V = lookAt(eye, at, up);

    // 1. Normal Teapot
    const M = mult(translate(0, -0.5, -3), scalem(0.25, 0.25, 0.25)); // Fixed position for part 1
    const MVP = mult(P, mult(V, M));
    const Nmat = transpose(inverse(M));
    
    writeTeapotUniforms(uboA, MVP, M, Nmat, eye, lightWorld, opts);

    // 2. Reflected Teapot
    const Mref = mult(R, M);
    const MVPref = mult(P, mult(V, Mref));
    const NmatRef = transpose(inverse(Mref));
    
    // Reflect light too
    const Lref4 = mult(R, vec4(lightWorld[0], lightWorld[1], lightWorld[2], 1.0));
    const lightRef = vec3(Lref4[0], Lref4[1], Lref4[2]);

    writeTeapotUniforms(uboB, MVPref, Mref, NmatRef, eye, lightRef, opts);

    // Draw
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: msaaTex.createView(),
        resolveTarget: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 }, // Cornflower Blue
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp: "clear",
        depthClearValue: 1.0,
        depthStoreOp: "store",
      }
    });

    pass.setPipeline(pipeline);
    pass.setIndexBuffer(teapotIdxBuf, "uint32");
    pass.setVertexBuffer(0, teapotPosBuf);
    pass.setVertexBuffer(1, teapotNorBuf);

    // Draw Reflected
    pass.setBindGroup(0, bgB);
    pass.drawIndexed(teapotIdx.length);

    // Draw Normal
    pass.setBindGroup(0, bgA);
    pass.drawIndexed(teapotIdx.length);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  setupInputListeners(render);
  requestAnimationFrame(render);
}

window.onload = main;