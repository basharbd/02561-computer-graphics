"use strict";

function createCheckerboardTexture(texSize, numRows, numCols) {
  const texels = new Uint8Array(4 * texSize * texSize);

  for (let i = 0; i < texSize; ++i) {
    for (let j = 0; j < texSize; ++j) {
      const patchx = Math.floor(i / (texSize / numRows));
      const patchy = Math.floor(j / (texSize / numCols));
      const c = (patchx % 2 !== patchy % 2) ? 255 : 0;

      const idx = 4 * (i * texSize + j);
      texels[idx + 0] = c;
      texels[idx + 1] = c;
      texels[idx + 2] = c;
      texels[idx + 3] = 255;
    }
  }
  return texels;
}

function getOptions() {
  const mipmapEnabled = document.getElementById("toggle-mipmap").checked;
  const wrappingMode = document.getElementById("texture-wrapping").value;
  const magFilter = document.getElementById("mag-filter").value;
  const minFilter = document.getElementById("min-filter").value;
  const mipmapFilter = document.getElementById("mipmap-filter").value;

  return { mipmapEnabled, wrappingMode, magFilter, minFilter, mipmapFilter };
}

function wireUI(render) {
  const ids = ["toggle-mipmap", "texture-wrapping", "mag-filter", "min-filter", "mipmap-filter"];
  for (const id of ids) document.getElementById(id).onchange = render;
}

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({ device, format: canvasFormat, alphaMode: "opaque" });

  // Geometry (same rectangle as Part 1)
  const positions = [
    vec3(-4, -1,  -1),
    vec3( 4, -1,  -1),
    vec3( 4, -1, -21),
    vec3(-4, -1, -21),
  ];

  const indices = new Uint32Array([ 0, 1, 2, 0, 2, 3 ]);

  const texcoords = [
    vec2(-1.5,  0.0),
    vec2( 2.5,  0.0),
    vec2( 2.5, 10.0),
    vec2(-1.5, 10.0),
  ];

  // Buffers
  const positionBuffer = device.createBuffer({
    size: sizeof["vec3"] * positions.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

  const texcoordBuffer = device.createBuffer({
    size: sizeof["vec2"] * texcoords.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(texcoordBuffer, 0, flatten(texcoords));

  // ✅ FIX: index buffer size must be indices.byteLength
  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  // MVP (90° FOV, identity view)
  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  const projection = mult(Mst, perspective(90, canvas.width / canvas.height, 0.1, 100.0));
  const V = mat4();
  const M = mat4();
  const mvp = mult(projection, mult(V, M));

  const uniformBuffer = device.createBuffer({
    size: 64, // mat4x4<f32>
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

  // Shader module
  const wgslFile = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslFile, { cache: "reload" }).then(r => r.text());
  const shaderModule = device.createShaderModule({ code: wgslCode });

  // Pipeline
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [
        {
          arrayStride: sizeof["vec3"],
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        },
        {
          arrayStride: sizeof["vec2"],
          attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "main_fs",
      targets: [{ format: canvasFormat }],
    },
    primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "back" },
    depthStencil: { depthWriteEnabled: true, depthCompare: "less", format: "depth24plus" },
  });

  // Depth
  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height, 1],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Checkerboard texture data
  const texSize = 64;
  const texels = createCheckerboardTexture(texSize, 8, 8);
  const fullMipCount = numMipLevels(texSize, texSize); // from genmipmap.js

  // UI behavior: disable mipmapFilter menu when mipmapping is off
  function updateMipmapUI() {
    const enabled = document.getElementById("toggle-mipmap").checked;
    document.getElementById("mipmap-filter").disabled = !enabled;
  }

  const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0);

  function render() {
    const opt = getOptions();
    updateMipmapUI();

    // Create texture with or without mip levels
    const mipLevelCount = opt.mipmapEnabled ? fullMipCount : 1;

    const texture = device.createTexture({
      size: [texSize, texSize, 1],
      format: "rgba8unorm",
      mipLevelCount,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Upload base level
    device.queue.writeTexture(
      { texture, mipLevel: 0 },
      texels,
      { bytesPerRow: texSize * 4, rowsPerImage: texSize },
      { width: texSize, height: texSize, depthOrArrayLayers: 1 }
    );

    // Generate mipmaps if enabled
    if (opt.mipmapEnabled) {
      generateMipmap(device, texture); // from genmipmap.js
    }

    // Sampler descriptor
    const sampler = device.createSampler({
      addressModeU: opt.wrappingMode,
      addressModeV: opt.wrappingMode,
      magFilter: opt.magFilter,
      minFilter: opt.minFilter,
      // If mipmapping disabled, mipmapFilter is irrelevant; keep it stable anyway:
      mipmapFilter: opt.mipmapEnabled ? opt.mipmapFilter : "nearest",
    });

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: texture.createView() },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
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

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, texcoordBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.drawIndexed(indices.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  wireUI(render);
  render();
}

window.onload = main;
