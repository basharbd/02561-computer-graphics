"use strict";

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas  = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format  = navigator.gpu.getPreferredCanvasFormat();

  context.configure({ device, format });

  // Cube vertices in [0,1]^3
  const positions = [
    vec3(0,0,1), vec3(0,1,1), vec3(1,1,1), vec3(1,0,1),
    vec3(0,0,0), vec3(0,1,0), vec3(1,1,0), vec3(1,0,0),
  ];

  // Wireframe edges (line-list via indices)
  const wire = new Uint32Array([
    0,1, 1,2, 2,3, 3,0,   // front
    4,5, 5,6, 6,7, 7,4,   // back
    0,4, 1,5, 2,6, 3,7    // connections
  ]);

  const positionBuffer = device.createBuffer({
    size: sizeof["vec3"] * positions.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

  const positionLayout = {
    arrayStride: sizeof["vec3"],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }]
  };

  // simple black per-vertex color
  const colors = Array.from({ length: positions.length }, () => vec4(0,0,0,1));
  const colorBuffer = device.createBuffer({
    size: sizeof["vec4"] * colors.length,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(colorBuffer, 0, flatten(colors));

  const colorLayout = {
    arrayStride: sizeof["vec4"],
    attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }]
  };

  const indexBuffer = device.createBuffer({
    size: wire.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(indexBuffer, 0, wire);

  const bg = vec4(0.3921, 0.5843, 0.9294, 1.0);

  // Depth fix (WebGPU depth range [0,1])
  const depthFix = mat4(
    1,0,0,0,
    0,1,0,0,
    0,0,0.5,0.5,
    0,0,0,1
  );

  // Center cube to origin
  const C = translate(-0.5, -0.5, -0.5);

  // Model transforms (three cubes)
  const M1 = mult(translate(0, 0, 4), C);
  const M2 = mult(translate(2, 0, 4), C);
  const M3 = mult(translate(-2, 0, 4), mult(rotateY(40), mult(rotateX(30), C)));
  const models = [M1, M2, M3];

  // Perspective projection + view
  let P = perspective(45, canvas.width / canvas.height, 0.1, 6.0);
  P = mult(depthFix, P);

  const V = lookAt(vec3(0,0,0), vec3(0,0,1), vec3(0,1,0));

  // MVP array (one per instance)
  const mvps = models.map(M => mult(P, mult(V, M)));

  // Uniform buffer stores 3 mat4
  const uniformBuffer = device.createBuffer({
    size: sizeof["mat4"] * mvps.length,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  for (let i = 0; i < mvps.length; i++) {
    device.queue.writeBuffer(uniformBuffer, sizeof["mat4"] * i, flatten(mvps[i]));
  }

  // WGSL
  const wgslPath = document.getElementById("wgsl").src;
  const wgslCode = await fetch(wgslPath, { cache: "reload" }).then(r => r.text());
  const shaderModule = device.createShaderModule({ code: wgslCode });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "main_vs",
      buffers: [positionLayout, colorLayout]
    },
    fragment: {
      module: shaderModule,
      entryPoint: "main_fs",
      targets: [{ format }]
    },
    primitive: { topology: "line-list" }
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });

  function render() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: bg[0], g: bg[1], b: bg[2], a: bg[3] }
      }]
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, colorBuffer);

    // 3 instances
    pass.drawIndexed(wire.length, mvps.length);

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  render();
}

window.onload = () => main();
