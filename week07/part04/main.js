"use strict";

function subdivideSphere(positions, indices) {
    const triangles = indices.length / 3;
    let newIndices = [];
    for (let i = 0; i < triangles; ++i) {
        const i0 = indices[i * 3 + 0]
        const i1 = indices[i * 3 + 1]
        const i2 = indices[i * 3 + 2]
        const c01 = positions.length;
        const c12 = positions.length + 1;
        const c20 = positions.length + 2;
        positions.push(normalize(add(positions[i0], positions[i1])))
        positions.push(normalize(add(positions[i1], positions[i2])))
        positions.push(normalize(add(positions[i2], positions[i0])))
        newIndices.push(i0, c01, c20, c20, c01, c12, c12, c01, i1, c20, c12, i2);
    }
    return newIndices;
}

function subdivideIndices(indices) {
    const triangles = indices.length / 3;
    let newIndices = [];
    for (let i = 0; i < triangles; ++i) {
        const i0 = indices[i * 3 + 0];
        const i1 = indices[i * 3 + 1];
        const i2 = indices[i * 3 + 2];
        const c01 = triangles + i * 3 + 0;
        const c12 = triangles + i * 3 + 1;
        const c20 = triangles + i * 3 + 2;
        newIndices.push(i0, c01, c20, c20, c01, c12, c12, c01, i1, c20, c12, i2);
    }
    return newIndices;
}

function courseIndices(indices) {
    const triangles = indices.length / 12;
    let newIndices = [];
    for (let i = 0; i < triangles; ++i) {
        let i0 = indices[i * 12 + 0];
        let i1 = indices[i * 12 + 8];
        let i2 = indices[i * 12 + 11];
        newIndices.push(i0, i1, i2);
    }
    return newIndices;
}

function setupInputListeners(render) {
    document.getElementById("toggle-mipmap").onchange = render;
    document.getElementById("texture-wrapping").onchange = render;
    document.getElementById("mag-filter").onchange = render;
    document.getElementById("min-filter").onchange = render;
    document.getElementById("mipmap-filter").onchange = render;
}

function getOptions() {
    const mipmapToggle = document.getElementById("toggle-mipmap");
    const wrappingSelect = document.getElementById("texture-wrapping");
    const magFilterSelect = document.getElementById("mag-filter");
    const minFilterSelect = document.getElementById("min-filter");
    const mipmapFilterSelect = document.getElementById("mipmap-filter");

    return {
        mipmapEnabled: mipmapToggle.checked,
        wrappingMode: wrappingSelect.value,
        magFilter: magFilterSelect.value,
        minFilter: minFilterSelect.value,
        mipmapFilter: mipmapFilterSelect.value,
    };
}

async function main() {
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

    const M_SQRT2 = Math.sqrt(2.0);
    const M_SQRT6 = Math.sqrt(6.0);
    let positions = [
        vec3(0.0, 0.0, 1.0),
        vec3(0.0, 2.0 * M_SQRT2 / 3.0, -1.0 / 3.0),
        vec3(-M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
        vec3(M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
    ];

    let indices = new Uint32Array([
        0, 1, 2, // front
        0, 3, 1, // right
        1, 3, 2, // left
        0, 2, 3, // bottom
    ]);

    const initialSubdivisions = 6;
    const maxSubdivisions = 8;
    for (let i = 0; i < initialSubdivisions; ++i) {
        indices = new Uint32Array(subdivideSphere(positions, indices));
    }

    let shouldAnimate = false;
    document.getElementById('toggle-animate').onclick = () => {
        shouldAnimate = !shouldAnimate;
        if (shouldAnimate) {
            lastTime = performance.now();
            requestAnimationFrame(animate);
        }
    };

    // Create position buffer
    const positionBuffer = device.createBuffer({
        size: sizeof['vec3'] * 4 ** (maxSubdivisions + 1),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const positionBufferLayout = {
        arrayStride: sizeof['vec3'],
        attributes: [{
            format: 'float32x3',
            offset: 0,
            shaderLocation: 0, // Position, see vertex shader
        }],
    };

    // Create index buffer
    const indicesBuffer = device.createBuffer({
        size: sizeof['vec3'] * 4 ** (maxSubdivisions + 1),
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });

    // Texture
    // FIX: "../textures/" (because we are in week07/part04/)
    const cupemap = [
        '../textures/cm_left.png',     // POSITIVE_X
        '../textures/cm_right.png',    // NEGATIVE_X
        '../textures/cm_top.png',      // POSITIVE_Y
        '../textures/cm_bottom.png',   // NEGATIVE_Y
        '../textures/cm_back.png',     // POSITIVE_Z
        '../textures/cm_front.png'     // NEGATIVE_Z
    ];

    const imgs = await Promise.all(cupemap.map(async (filename) => {
        const response = await fetch(filename);
        const blob = await response.blob();
        return await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    }));

    // FIX: "../textures/normalmap.png"
    const normalMap = await createImageBitmap(
        await (await fetch('../textures/normalmap.png')).blob(),
        { colorSpaceConversion: 'none' }
    );

    const normalTex = device.createTexture({
        dimension: '2d',
        size: [normalMap.width, normalMap.height, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST
            | GPUTextureUsage.TEXTURE_BINDING
            | GPUTextureUsage.RENDER_ATTACHMENT
    });

    device.queue.copyExternalImageToTexture(
        { source: normalMap, flipY: true },
        { texture: normalTex },
        { width: normalMap.width, height: normalMap.height },
    );

    normalTex.sampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        minFilter: 'linear',
        magFilter: 'linear',
        mipmapFilter: 'linear',
    });

    const bgcolor = vec4(0.0, 0.0, 0.0, 1.0) // Black

    // Matrix setup
    const Mst = mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    )

    const center = translate(0, 0, 0);
    const M = center;

    let projection = perspective(120, canvas.width / canvas.height, 0.1, 100);
    projection = mult(Mst, projection);

    const r = 2;
    let angle = 0;

    const uniformBuffer = device.createBuffer({
        size: sizeof['mat4'] * 2 + 4 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformBufferBg = device.createBuffer({
        size: sizeof['mat4'] * 2 + 4 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Load WGSL code
    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode
        = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({
        code: wgslcode
    });

    const msaaCount = 4;

    // Create pipeline
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [positionBufferLayout],
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

    const msaaTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: canvasFormat,
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    let cubeTex;
    function updateTextureRender() {
        const options = getOptions();

        cubeTex = device.createTexture({
            dimension: '2d',
            size: [imgs[0].width, imgs[0].height, 6],
            format: "rgba8unorm",
            usage: GPUTextureUsage.COPY_DST
                | GPUTextureUsage.TEXTURE_BINDING
                | GPUTextureUsage.RENDER_ATTACHMENT
        });

        imgs.forEach((img, i) => {
            device.queue.copyExternalImageToTexture(
                { source: img, flipY: true },
                { texture: cubeTex, origin: [0, 0, i] },
                { width: img.width, height: img.height },
            );
        });

        // if (options.mipmapEnabled) {
        //     generateMipmap(device, cubeTex);
        // }

        cubeTex.sampler = device.createSampler({
            addressModeU: options.wrappingMode,
            addressModeV: options.wrappingMode,
            minFilter: options.minFilter,
            magFilter: options.magFilter,
            mipmapFilter: options.mipmapFilter,
        });
    }
    updateTextureRender();

    function render() {
        const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: cubeTex.sampler },
                { binding: 2, resource: cubeTex.createView({ dimension: 'cube' }) },
                { binding: 3, resource: normalTex.sampler },
                { binding: 4, resource: normalTex.createView() },
            ],
        });

        const bindGroupBg = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformBufferBg } },
                { binding: 1, resource: cubeTex.sampler },
                { binding: 2, resource: cubeTex.createView({ dimension: 'cube' }) },
                { binding: 3, resource: normalTex.sampler },
                { binding: 4, resource: normalTex.createView() },
            ],
        });

        // Camera + uniforms
        const eye = vec3(r * Math.sin(angle), 0, r * Math.cos(angle));
        const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
        const mvp = mult(projection, mult(V, M));

        let Vinv = inverse(V);
        Vinv[0][3] = 0;
        Vinv[1][3] = 0;
        Vinv[2][3] = 0;
        Vinv[3][3] = 0;

        const mtex = mult(Vinv, inverse(projection));

        const bgPositions = [
            vec3(-1, -1, 0.999),
            vec3(-1, 1, 0.999),
            vec3(1, -1, 0.999),
            vec3(1, 1, 0.999),
        ];

        const bgIndices = new Uint32Array([
            0, 2, 1,
            2, 3, 1,
        ]);

        device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));
        device.queue.writeBuffer(uniformBuffer, 64, flatten(mat4())); // Identity mtex for sphere
        device.queue.writeBuffer(uniformBuffer, 128, flatten(eye));
        device.queue.writeBuffer(uniformBuffer, 128 + 3 * 4, new Uint32Array([1])); // Reflective = true

        device.queue.writeBuffer(uniformBufferBg, 0, flatten(mat4())); // Identity mvp for background
        device.queue.writeBuffer(uniformBufferBg, 64, flatten(mtex));
        device.queue.writeBuffer(uniformBufferBg, 128, flatten(eye));
        device.queue.writeBuffer(uniformBufferBg, 128 + 3 * 4, new Uint32Array([0])); // Reflective = false

        device.queue.writeBuffer(positionBuffer, 0, flatten(bgPositions));
        device.queue.writeBuffer(indicesBuffer, 0, bgIndices);

        device.queue.writeBuffer(positionBuffer, 4 * 3 * 4, flatten(positions));
        device.queue.writeBuffer(indicesBuffer, 4 * 6, indices);

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

        pass.setPipeline(pipeline);
        pass.setIndexBuffer(indicesBuffer, 'uint32');
        pass.setVertexBuffer(0, positionBuffer);

        // Draw sphere
        pass.setBindGroup(0, bindGroup);
        pass.drawIndexed(indices.length, 1, 6, 4);

        // Draw background
        pass.setBindGroup(0, bindGroupBg);
        pass.drawIndexed(bgIndices.length, 1);

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    let lastTime = performance.now();

    function animate(timestamp) {
        angle += (timestamp - lastTime) * 0.0015;
        lastTime = timestamp;
        render();
        if (shouldAnimate) {
            requestAnimationFrame(animate);
        }
    }

    function updateAndRender() {
        updateTextureRender();
        render();
    }

    setupInputListeners(updateAndRender);
    render();
}

window.onload = function () { main(); }
