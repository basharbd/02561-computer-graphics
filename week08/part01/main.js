"use strict";

async function main() {
    // --- WebGPU setup (adapter/device/canvas/context) ---
    const gpu = navigator.gpu;
    const adapter = await gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById('my-canvas');
    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });

    // --- Scene geometry: ground + two quads (all share one position buffer) ---
    let positions = [
        // Ground quad
        vec3(-2, -1, -1),
        vec3(2, -1, -1),
        vec3(2, -1, -5),
        vec3(-2, -1, -5),
        // Quad A
        vec3(0.25, -0.5, -1.25),
        vec3(0.75, -0.5, -1.25),
        vec3(0.75, -0.5, -1.75),
        vec3(0.25, -0.5, -1.75),
        // Quad B
        vec3(-1, -1, -2.5),
        vec3(-1, -1, -3.0),
        vec3(-1, 0, -3.0),
        vec3(-1, 0, -2.5),
    ];

    // --- Indices: 2 triangles per quad (ground first, then A, then B) ---
    let indices = new Uint32Array([
        // Ground quad
        0, 1, 2,
        0, 2, 3,
        // Quad A
        4, 5, 6,
        4, 6, 7,
        // Quad B
        8, 9, 10,
        8, 10, 11,
    ]);

    // --- Position buffer + vertex layout (shaderLocation 0) ---
    const positionBuffer = device.createBuffer({
        size: sizeof['vec3'] * positions.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const positionBufferLayout = {
        arrayStride: sizeof['vec3'],
        attributes: [{
            format: 'float32x3',
            offset: 0,
            shaderLocation: 0,
        }],
    };

    // --- Index buffer (uint32) ---
    const indicesBuffer = device.createBuffer({
        size: sizeof['vec3'] * indices.length,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });

    // --- Texture coordinates: one UV quad per object (shaderLocation 1) ---
    // (Same UV pattern for ground, Quad A, Quad B)
    const texcoords = [
        // Ground quad
        vec2(0.0, 0.0),
        vec2(1.0, 0.0),
        vec2(1.0, 1.0),
        vec2(0.0, 1.0),
        // Quad A
        vec2(0.0, 0.0),
        vec2(1.0, 0.0),
        vec2(1.0, 1.0),
        vec2(0.0, 1.0),
        // Quad B
        vec2(0.0, 0.0),
        vec2(1.0, 0.0),
        vec2(1.0, 1.0),
        vec2(0.0, 1.0),
    ];
    const texcoordBuffer = device.createBuffer({
        size: sizeof['vec2'] * texcoords.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const texcoordBufferLayout = {
        arrayStride: sizeof['vec2'],
        attributes: [{
            format: 'float32x2',
            offset: 0,
            shaderLocation: 1,
        }],
    };

    // --- Upload geometry data to GPU ---
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
    device.queue.writeBuffer(indicesBuffer, 0, indices);
    device.queue.writeBuffer(texcoordBuffer, 0, flatten(texcoords));

    // --- Ground texture load  ---
    const filename = '../textures/xamp23.png';

    const response = await fetch(filename);
    const blob = await response.blob();
    const img = await createImageBitmap(blob, { colorSpaceConversion: 'none' });

    // --- GPU texture for ground image ---
    const textureGround = device.createTexture({
        size: [img.width, img.height, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture(
        { source: img, flipY: true },
        { texture: textureGround },
        { width: img.width, height: img.height },
    );

    // --- Sampler for ground texture (clamp + linear) ---
    textureGround.sampler = device.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        minFilter: 'linear',
        magFilter: 'linear',
    });

    // --- 1x1 red texture for the objects (procedural) ---
    const textureRed = device.createTexture({
        size: [1, 1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING
    });
    device.queue.writeTexture(
        { texture: textureRed },
        new Uint8Array([255, 0, 0, 255]), // a single opaque red pixel
        { offset: 0, bytesPerRow: 4, rowsPerImage: 1 },
        [1, 1, 1]
    );

    // --- Sampler for red texture (clamp + nearest/linear mix) ---
    textureRed.sampler = device.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        minFilter: 'nearest',
        magFilter: 'linear',
    });

    // --- Clear color (Cornflower blue) ---
    const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0) // Cornflower

    // --- Depth fix matrix (WebGPU clip-space z in [0,1]) ---
    const Mst = mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    )

    // --- Model transform (identity-ish) ---
    const center = translate(0, 0, 0);
    const M = center;

    // --- Projection (perspective) ---
    const fov = 90;
    let projection = perspective(fov, canvas.width / canvas.height, 0.1, 100);
    projection = mult(Mst, projection);

    // --- View transform (identity) ---
    const V = mat4();

    // --- Final MVP ---
    const mvp = mult(projection, mult(V, M));

    // --- Uniform buffer (MVP only) ---
    const uniformBuffer = device.createBuffer({
        size: sizeof['mat4'],
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

    // --- Load WGSL source from <script id="wgsl" ...> ---
    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode
        = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({
        code: wgslcode
    });

    // --- MSAA settings ---
    const msaaCount = 4;

    // --- Render pipeline: positions + texcoords, textured fragment ---
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [positionBufferLayout, texcoordBufferLayout],
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs',
            targets: [{ format: canvasFormat }],
        },
        primitive: {
            topology: 'triangle-list',
            frontFace: 'ccw',
            cullMode: 'back'
        },
        multisample: { count: msaaCount },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus',
        },
    });

    // --- MSAA color target ---
    const msaaTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: canvasFormat,
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // --- MSAA depth target ---
    const depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // --- Bind group for ground: MVP + ground sampler + ground texture ---
    const bindGroupGround = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: textureGround.sampler },
            { binding: 2, resource: textureGround.createView() },
        ],
    });

    // --- Bind group for objects: MVP + red sampler + red texture ---
    const bindGroupObjects = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: textureRed.sampler },
            { binding: 2, resource: textureRed.createView() },
        ],
    });

    function render() {
        // --- Encode one frame ---
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: msaaTexture.createView(),
                resolveTarget: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: bgcolor[0], g: bgcolor[1], b: bgcolor[2], a: bgcolor[3] },
            }],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthLoadOp: "clear",
                depthClearValue: 1.0,
                depthStoreOp: "store",
            }
        });

        // --- Common pipeline + buffers ---
        pass.setPipeline(pipeline);
        pass.setIndexBuffer(indicesBuffer, 'uint32');
        pass.setVertexBuffer(0, positionBuffer);
        pass.setVertexBuffer(1, texcoordBuffer);

        // --- Draw ground (first 6 indices) ---
        pass.setBindGroup(0, bindGroupGround);
        pass.drawIndexed(6);

        // --- Draw the two object quads (remaining indices, starting after ground) ---
        pass.setBindGroup(0, bindGroupObjects);
        pass.drawIndexed(indices.length - 6, 1, 6);

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    // --- Initial draw ---
    render();
}

window.onload = function () { main(); }
