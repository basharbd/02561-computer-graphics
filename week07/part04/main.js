"use strict";

// sphere subdivision: split each triangle into 4 (adds 3 new midpoints per triangle)
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

// index-only subdivision (assumes new vertices are appended in a known order)
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

// coarsen one subdivision level (recover the original triangle corners)
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

// hook UI controls to re-render
function setupInputListeners(render) {
    document.getElementById("toggle-mipmap").onchange = render;
    document.getElementById("texture-wrapping").onchange = render;
    document.getElementById("mag-filter").onchange = render;
    document.getElementById("min-filter").onchange = render;
    document.getElementById("mipmap-filter").onchange = render;
}

// read current UI options
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
    // WebGPU init
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

    // tetrahedron base vertices (unit-ish sphere seed)
    const M_SQRT2 = Math.sqrt(2.0);
    const M_SQRT6 = Math.sqrt(6.0);
    let positions = [
        vec3(0.0, 0.0, 1.0),
        vec3(0.0, 2.0 * M_SQRT2 / 3.0, -1.0 / 3.0),
        vec3(-M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
        vec3(M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
    ];

    // tetrahedron indices
    let indices = new Uint32Array([
        0, 1, 2, // front
        0, 3, 1, // right
        1, 3, 2, // left
        0, 2, 3, // bottom
    ]);

    // pre-subdivide sphere geometry
    const initialSubdivisions = 6;
    const maxSubdivisions = 8;
    for (let i = 0; i < initialSubdivisions; ++i) {
        indices = new Uint32Array(subdivideSphere(positions, indices));
    }

    // animation toggle
    let shouldAnimate = false;
    document.getElementById('toggle-animate').onclick = () => {
        shouldAnimate = !shouldAnimate;
        if (shouldAnimate) {
            lastTime = performance.now();
            requestAnimationFrame(animate);
        }
    };

    // position buffer (shared for background + sphere)
    const positionBuffer = device.createBuffer({
        size: sizeof['vec3'] * 4 ** (maxSubdivisions + 1),
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

    // index buffer (shared for background + sphere)
    const indicesBuffer = device.createBuffer({
        size: sizeof['vec3'] * 4 ** (maxSubdivisions + 1),
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });

    // cubemap face paths (week07/part04 -> ../textures/)
    const cupemap = [
        '../textures/cm_left.png',
        '../textures/cm_right.png',
        '../textures/cm_top.png',
        '../textures/cm_bottom.png',
        '../textures/cm_back.png',
        '../textures/cm_front.png'
    ];

    // load cubemap faces
    const imgs = await Promise.all(cupemap.map(async (filename) => {
        const response = await fetch(filename);
        const blob = await response.blob();
        return await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    }));

    // load normal map
    const normalMap = await createImageBitmap(
        await (await fetch('../textures/normalmap.png')).blob(),
        { colorSpaceConversion: 'none' }
    );

    // normal-map texture setup
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

    // normal-map sampler
    normalTex.sampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        minFilter: 'linear',
        magFilter: 'linear',
        mipmapFilter: 'linear',
    });

    // clear color
    const bgcolor = vec4(0.0, 0.0, 0.0, 1.0)

    // depth fix for WebGPU clip space
    const Mst = mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    )

    // model transform
    const center = translate(0, 0, 0);
    const M = center;

    // projection matrix
    let projection = perspective(120, canvas.width / canvas.height, 0.1, 100);
    projection = mult(Mst, projection);

    // orbit camera params
    const r = 2;
    let angle = 0;

    // uniforms for sphere
    const uniformBuffer = device.createBuffer({
        size: sizeof['mat4'] * 2 + 4 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // uniforms for background
    const uniformBufferBg = device.createBuffer({
        size: sizeof['mat4'] * 2 + 4 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // load WGSL shader source
    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode
        = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({
        code: wgslcode
    });

    const msaaCount = 4;

    // render pipeline
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

    // MSAA color target
    const msaaTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: canvasFormat,
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // MSAA depth target
    const depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // cubemap texture updated on UI changes
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

        // upload faces into array layers
        imgs.forEach((img, i) => {
            device.queue.copyExternalImageToTexture(
                { source: img, flipY: true },
                { texture: cubeTex, origin: [0, 0, i] },
                { width: img.width, height: img.height },
            );
        });

        // mipmaps disabled here (kept as-is)
        // if (options.mipmapEnabled) {
        //     generateMipmap(device, cubeTex);
        // }

        // cubemap sampler from UI
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
        // bind group for sphere draw
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

        // bind group for background draw
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

        // camera matrices
        const eye = vec3(r * Math.sin(angle), 0, r * Math.cos(angle));
        const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
        const mvp = mult(projection, mult(V, M));

        // inverse view (translation cleared)
        let Vinv = inverse(V);
        Vinv[0][3] = 0;
        Vinv[1][3] = 0;
        Vinv[2][3] = 0;
        Vinv[3][3] = 0;

        // background direction transform
        const mtex = mult(Vinv, inverse(projection));

        // fullscreen background quad data
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

        // sphere uniforms
        device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));
        device.queue.writeBuffer(uniformBuffer, 64, flatten(mat4()));
        device.queue.writeBuffer(uniformBuffer, 128, flatten(eye));
        device.queue.writeBuffer(uniformBuffer, 128 + 3 * 4, new Uint32Array([1]));

        // background uniforms
        device.queue.writeBuffer(uniformBufferBg, 0, flatten(mat4()));
        device.queue.writeBuffer(uniformBufferBg, 64, flatten(mtex));
        device.queue.writeBuffer(uniformBufferBg, 128, flatten(eye));
        device.queue.writeBuffer(uniformBufferBg, 128 + 3 * 4, new Uint32Array([0]));

        // upload background geometry into shared buffers
        device.queue.writeBuffer(positionBuffer, 0, flatten(bgPositions));
        device.queue.writeBuffer(indicesBuffer, 0, bgIndices);

        // upload sphere geometry after background region in shared buffers
        device.queue.writeBuffer(positionBuffer, 4 * 3 * 4, flatten(positions));
        device.queue.writeBuffer(indicesBuffer, 4 * 6, indices);

        // begin render pass
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

        // draw sphere
        pass.setBindGroup(0, bindGroup);
        pass.drawIndexed(indices.length, 1, 6, 4);

        // draw background
        pass.setBindGroup(0, bindGroupBg);
        pass.drawIndexed(bgIndices.length, 1);

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    // animation loop timing
    let lastTime = performance.now();

    function animate(timestamp) {
        angle += (timestamp - lastTime) * 0.0015;
        lastTime = timestamp;
        render();
        if (shouldAnimate) {
            requestAnimationFrame(animate);
        }
    }

    // update texture + render
    function updateAndRender() {
        updateTextureRender();
        render();
    }

    setupInputListeners(updateAndRender);
    render();
}

window.onload = function () { main(); }
