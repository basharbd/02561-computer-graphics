"use strict";

function createCheckerboardTexture(texSize, numRows, numCols) {
  // RGBA8 checkerboard texels
  const texels = new Uint8Array(4 * texSize * texSize);

  for (let i = 0; i < texSize; ++i) {
    for (let j = 0; j < texSize; ++j) {
      // choose which checker patch this texel belongs to
      const patchx = Math.floor(i / (texSize / numRows));
      const patchy = Math.floor(j / (texSize / numCols));
      const c = (patchx % 2 !== patchy % 2) ? 255 : 0;

      // write RGBA
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
  // read UI state
  const mipmapEnabled = document.getElementById("toggle-mipmap").checked;
  const wrappingMode = document.getElementById("texture-wrapping").value;
  const magFilter = document.getElementById("mag-filter").value;
  const minFilter = document.getElementById("min-filter").value;
  const mipmapFilter = document.getElementById("mipmap-filter").value;

  return { mipmapEnabled, wrappingMode, magFilter, minFilter, mipmapFilter };
}

function wireUI(render) {
  // re-render when UI changes
  const ids = ["toggle-mipmap", "texture-wrapping", "mag-filter", "min-filter", "mipmap-filter"];
  for (const id of ids) document.getElementById(id).onchange = render;
}

async function main() {
  if (!navigator.gpu) throw new Error("WebGPU not supported.");

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("Failed to get GPU adapter.");
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  context.configure({ device, format: canvasFormat, alphaMode: "opaque" });

  // Ground quad geometry
  const positions = [
    vec3(-4, -1,  -1),
    vec3( 4, -1,  -1),
    vec3( 4, -1, -21),
    vec3(-4, -1, -21),
  ];

  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

  // UVs (repeat along the quad)
  const texcoords = [
    vec2(-1.5,  0.0),
    vec2( 2.5,  0.0),
    vec2( 2.5, 10.0),
    vec2(-1.5, 10.0),
  ];

  // Position buffer
  const positionBuffer = device.createBuffer({
    size: sizeof["vec3"] * positions.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

  // Texcoord buffer
  const texcoordBuffer = device.createBuffer({
    size: sizeof["vec2"] * texcoords.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(texcoordBuffer, 0, flatten(texcoords));

  // Index buffer
  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  // Depth remap matrix (clip z -> [0,1])
  const Mst = mat4(
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0
  );

  // MVP (identity view/model)
  const projection = mult(Mst, perspective(90, canvas.width / canvas.height, 0.1, 100.0));
  const V = mat4();
  const M = mat4();
  const mvp = mult(projection, mult(V, M));

  // Uniform buffer (mat4)
  const uniformBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

  // Load WGSL and create pipeline
  const wgslFile = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslFile, { cache: "reload" }).then((r) => r.text());
  const shaderModule = device.createShaderModule({ code: wgslCode });

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

  // Depth buffer
  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height, 1],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Checkerboard base level
  const texSize = 64;
  const texels = createCheckerboardTexture(texSize, 8, 8);
  const fullMipCount = numMipLevels(texSize, texSize);

  // Disable mipmapFilter control when mipmaps are off
  function updateMipmapUI() {
    const enabled = document.getElementById("toggle-mipmap").checked;
    document.getElementById("mipmap-filter").disabled = !enabled;
  }

  // Clear color
  const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0);

  function render() {
    // read UI and update UI state
    const opt = getOptions();
    updateMipmapUI();

    // choose mip levels for the texture view
    const mipLevelCount = opt.mipmapEnabled ? fullMipCount : 1;

    // (re)create texture so mipLevelCount matches current UI
    const texture = device.createTexture({
      size: [texSize, texSize, 1],
      format: "rgba8unorm",
      mipLevelCount,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // upload base mip level
    device.queue.writeTexture(
      { texture, mipLevel: 0 },
      texels,
      { bytesPerRow: texSize * 4, rowsPerImage: texSize },
      { width: texSize, height: texSize, depthOrArrayLayers: 1 }
    );

    // generate mip chain
    if (opt.mipmapEnabled) generateMipmap(device, texture);

    // build sampler from UI
    const sampler = device.createSampler({
      addressModeU: opt.wrappingMode,
      addressModeV: opt.wrappingMode,
      magFilter: opt.magFilter,
      minFilter: opt.minFilter,
      mipmapFilter: opt.mipmapEnabled ? opt.mipmapFilter : "nearest",
    });

    // bind uniforms + sampler + texture
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: texture.createView() },
      ],
    });

    // draw pass
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

  // initial UI wiring + first frame
  wireUI(render);
  render();
}

window.onload = main;
