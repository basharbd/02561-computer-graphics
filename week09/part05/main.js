"use strict";

function setupInputListeners(onchange) {
    document.getElementById('emitted-radiance').oninput = onchange;
    document.getElementById('ambient-radiance').oninput = onchange;
    document.getElementById('diffuse').oninput = onchange;
    document.getElementById('specular').oninput = onchange;
    document.getElementById('shininess').oninput = onchange;
}

function getOptions() {
    const emittedRadianceSlider = document.getElementById('emitted-radiance');
    const ambientRadianceSlider = document.getElementById('ambient-radiance');
    const diffuseSlider = document.getElementById('diffuse');
    const specularSlider = document.getElementById('specular');
    const shininessSlider = document.getElementById('shininess');

    return {
        emittedRadianceSlider: parseFloat(emittedRadianceSlider.value),
        ambientRadianceSlider: parseFloat(ambientRadianceSlider.value),
        diffuseSlider: parseFloat(diffuseSlider.value),
        specularSlider: parseFloat(specularSlider.value),
        shininessSlider: parseFloat(shininessSlider.value),
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

    // SHARED
    const positionBufferLayout = {
        arrayStride: sizeof['vec4'],
        attributes: [{
            format: 'float32x4',
            offset: 0,
            shaderLocation: 0,
        }],
    };


    // TEAPOT
    const obj_filename = "../textures/teapot.obj"; // CORRECTED PATH
    const obj = await readOBJFile(obj_filename, 1, true);

    const teapotPositions = obj.vertices;
    const teapotPositionBuffer = device.createBuffer({
        size: sizeof['vec4'] * teapotPositions.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(teapotPositionBuffer, 0, flatten(teapotPositions));

    const teapotColors = obj.colors;
    const teapotColorBuffer = device.createBuffer({
        size: sizeof['vec4'] * teapotColors.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const teapotColorBufferLayout = {
        arrayStride: sizeof['vec4'],
        attributes: [{
            format: 'float32x4',
            offset: 0,
            shaderLocation: 1,
        }],
    };
    device.queue.writeBuffer(teapotColorBuffer, 0, flatten(teapotColors));

    const teapotNormals = obj.normals;
    const teapotNormalBuffer = device.createBuffer({
        size: sizeof['vec4'] * teapotNormals.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const teapotNormalBufferLayout = {
        arrayStride: sizeof['vec4'],
        attributes: [{
            format: 'float32x4',
            offset: 0,
            shaderLocation: 2,
        }],
    };
    device.queue.writeBuffer(teapotNormalBuffer, 0, flatten(teapotNormals));

    const teapotIndices = obj.indices;
    const teapotIndicesBuffer = device.createBuffer({
        size: sizeof['vec4'] * teapotIndices.length,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(teapotIndicesBuffer, 0, teapotIndices);

    const teapotUniformBuffer = device.createBuffer({
        size: sizeof['mat4'] * 3 + sizeof['vec4'] * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // GROUND
    let positionsGround = [
        vec3(-2, -1, -1),
        vec3(2, -1, -1),
        vec3(2, -1, -5),
        vec3(-2, -1, -5),
    ];

    let indicesGround = new Uint32Array([
        0, 1, 2,
        0, 2, 3,
    ]);

    const groundPositionBuffer = device.createBuffer({
        size: sizeof['vec3'] * positionsGround.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    const groundPositionBufferLayout = {
        arrayStride: sizeof['vec3'],
        attributes: [{
            format: 'float32x3',
            offset: 0,
            shaderLocation: 0,
        }],
    };

    const groundIndicesBuffer = device.createBuffer({
        size: sizeof['vec3'] * indicesGround.length,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });

    const groundTexcoords = [
        vec2(0.0, 0.0),
        vec2(1.0, 0.0),
        vec2(1.0, 1.0),
        vec2(0.0, 1.0),
    ];
    const groundTexcoordBuffer = device.createBuffer({
        size: sizeof['vec2'] * groundTexcoords.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const groundTexcoordBufferLayout = {
        arrayStride: sizeof['vec2'],
        attributes: [{
            format: 'float32x2',
            offset: 0,
            shaderLocation: 3,
        }],
    };

    device.queue.writeBuffer(groundPositionBuffer, 0, flatten(positionsGround));
    device.queue.writeBuffer(groundIndicesBuffer, 0, indicesGround);
    device.queue.writeBuffer(groundTexcoordBuffer, 0, flatten(groundTexcoords));

    const filename = '../textures/xamp23.png'; // CORRECTED PATH
    const response = await fetch(filename);
    const blob = await response.blob();
    const img = await createImageBitmap(blob, { colorSpaceConversion: 'none' });

    const groundTexture = device.createTexture({
        size: [img.width, img.height, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture(
        { source: img, flipY: true },
        { texture: groundTexture },
        { width: img.width, height: img.height },
    );

    groundTexture.sampler = device.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        minFilter: 'linear',
        magFilter: 'linear',
    });

    const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0) // Cornflower

    const groundUniformBuffer = device.createBuffer({
        size: sizeof['mat4'] * 3 + sizeof['vec4'] * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const Mst = mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    )

    const center = translate(0, 0, 0);
    const M = center;


    const fov = 90;
    let projection = perspective(fov, canvas.width / canvas.height, 1, 20);
    projection = mult(Mst, projection);

    const V = mat4();
    const mvp = mult(projection, mult(V, M));

    device.queue.writeBuffer(groundUniformBuffer, 0, flatten(mvp));
    // Eye position padding logic looks okay
    device.queue.writeBuffer(groundUniformBuffer, sizeof['mat4'] * 3, new Float32Array([0.0, 0.0, 0.0, 1.0]));

    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({ code: wgslcode });

    const msaaCount = 4;

    const groundPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs_ground',
            buffers: [groundPositionBufferLayout, groundTexcoordBufferLayout],
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs_ground',
            targets: [{ format: canvasFormat }],
        },
        primitive: {
            topology: 'triangle-list',
            frontFace: 'ccw',
            cullMode: 'none',
        },
        multisample: { count: msaaCount },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus',
        },
    });

    const teapotPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs_teapot',
            buffers: [positionBufferLayout, teapotColorBufferLayout, teapotNormalBufferLayout],
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs_teapot',
            targets: [{ format: canvasFormat }],
        },
        primitive: {
            topology: 'triangle-list',
            frontFace: 'ccw',
            cullMode: 'none',
        },
        multisample: { count: msaaCount },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus',
        },
    });

    // Create a texture to render the shadow depth map into
    // We use rgba32float to store depth in the red channel
    const renderTexture = device.createTexture({
        size: [2048, 2048, 1],
        format: 'rgba32float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Create another pipeline for shadow projection
    const pipelineShadows = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs_depth',
            buffers: [positionBufferLayout],
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs_depth',
            targets: [{ format: renderTexture.format }],
        },
        primitive: {
            topology: 'triangle-list',
            frontFace: 'ccw',
            cullMode: 'none',
        },
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
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    const shadowDepthTexture = device.createTexture({
        size: [2048, 2048, 1],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    const groundBindGroup = device.createBindGroup({
        layout: groundPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: groundUniformBuffer } },
            { binding: 1, resource: groundTexture.sampler },
            { binding: 2, resource: groundTexture.createView() },
            { binding: 3, resource: renderTexture.createView() },
        ],
    });

    const teapotBindGroup = device.createBindGroup({
        layout: teapotPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: teapotUniformBuffer } },
            { binding: 3, resource: renderTexture.createView() },
        ],
    });

    const shadowsBindGroup = device.createBindGroup({
        layout: pipelineShadows.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: teapotUniformBuffer } },
        ],
    });


    document.getElementById('toggle-animate-light').onclick = () => {
        animateLight = !animateLight;
        if (animateLight && !animateTeapot) {
            lastTime = performance.now();
            requestAnimationFrame(animate);
        }
    };

    document.getElementById('toggle-animate-teapot').onclick = () => {
        animateTeapot = !animateTeapot;
        if (animateTeapot && !animateLight) {
            lastTime = performance.now();
            requestAnimationFrame(animate);
        }
    };

    let lastTime = performance.now();
    let animateLight = false;
    let animateTeapot = false;

    let lightAngle = 45;
    const lightRadius = 2.0;
    let lightPos = vec3(lightRadius * Math.sin(lightAngle), 2, -2 + lightRadius * Math.cos(lightAngle));

    let teapotY = -0.5;
    let direction = 1;
    let M_teapot = mult(translate(0, teapotY, -3), scalem(0.25, 0.25, 0.25));
    let mvp_teapot = mult(projection, mult(V, M_teapot));
    const eye = vec3(0, 0, 0);

    let lightViewProj = computeLightViewProjection();

    function computeLightViewProjection() {
        // Adjust light view target if necessary to cover the scene
        const lightView = lookAt(lightPos, vec3(0, teapotY, -3), vec3(0, 1, 0));
        const lightProjection = perspective(120, 1, 1, 10);
        return mult(lightProjection, lightView);
    }

    function updateLightPosition(timestamp) {
        lightAngle += (timestamp - lastTime) * 0.0025;
        lightPos = vec3(lightRadius * Math.sin(lightAngle), 2, -2 + lightRadius * Math.cos(lightAngle));
        lightViewProj = computeLightViewProjection();
    }

    function updateTeatpotPosition(timestamp) {
        teapotY = teapotY + direction * 0.0005 * (timestamp - lastTime);
        if (teapotY < -1.0) {
            teapotY = -1.0;
            direction = 1;
        }
        else if (teapotY > -0.5) {
            teapotY = -0.5;
            direction = -1;
        }
        M_teapot = mult(translate(0, teapotY, -3), scalem(0.25, 0.25, 0.25));
        mvp_teapot = mult(projection, mult(V, M_teapot));
        lightViewProj = computeLightViewProjection();
    }

    function updateUniforms() {
        const options = getOptions();
        const teapotUniforms = new Float32Array([
            ...flatten(eye), 1.0,
            ...flatten(lightPos), options.emittedRadianceSlider,
            options.ambientRadianceSlider, options.diffuseSlider, options.specularSlider, options.shininessSlider,
        ]);
        device.queue.writeBuffer(teapotUniformBuffer, 0, flatten(mvp_teapot));
        device.queue.writeBuffer(teapotUniformBuffer, sizeof['mat4'], flatten(M_teapot));
        device.queue.writeBuffer(teapotUniformBuffer, sizeof['mat4'] * 2, flatten(lightViewProj));
        device.queue.writeBuffer(teapotUniformBuffer, sizeof['mat4'] * 3, teapotUniforms);

        device.queue.writeBuffer(groundUniformBuffer, sizeof['mat4'] * 2, flatten(lightViewProj));
    }

    function animate(timestamp) {
        if (animateLight) {
            updateLightPosition(timestamp);
        }
        if (animateTeapot) {
            updateTeatpotPosition(timestamp);
        }
        lastTime = timestamp;
        updateUniforms();
        render();
        if (animateLight || animateTeapot) {
            requestAnimationFrame(animate);
        }
    }

    function render() {
        // console.log("Render frame");

        const encoder = device.createCommandEncoder();

        // 1. Shadow Pass
        const initialPass = encoder.beginRenderPass({
            colorAttachments: [{
                view: renderTexture.createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 1.0, g: 0.0, b: 0.0, a: 1.0 },
            }],
            depthStencilAttachment: {
                view: shadowDepthTexture.createView(),
                depthLoadOp: "clear",
                depthClearValue: 1.0,
                depthStoreOp: "store",
            }
        });
        initialPass.setPipeline(pipelineShadows);
        initialPass.setIndexBuffer(teapotIndicesBuffer, 'uint32');
        initialPass.setVertexBuffer(0, teapotPositionBuffer);
        initialPass.setBindGroup(0, shadowsBindGroup);
        initialPass.drawIndexed(teapotIndices.length);
        initialPass.end();

        // 2. Main Pass
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

        // Draw Ground
        pass.setPipeline(groundPipeline);
        pass.setIndexBuffer(groundIndicesBuffer, 'uint32');
        pass.setVertexBuffer(0, groundPositionBuffer);
        pass.setVertexBuffer(1, groundTexcoordBuffer);
        pass.setBindGroup(0, groundBindGroup);
        pass.drawIndexed(6);

        // Draw Teapot
        pass.setPipeline(teapotPipeline);
        pass.setIndexBuffer(teapotIndicesBuffer, 'uint32');
        pass.setVertexBuffer(0, teapotPositionBuffer);
        pass.setVertexBuffer(1, teapotColorBuffer);
        pass.setVertexBuffer(2, teapotNormalBuffer);
        pass.setBindGroup(0, teapotBindGroup);
        pass.drawIndexed(teapotIndices.length);

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    setupInputListeners(() => {
        if (!(animateLight || animateTeapot)) {
            requestAnimationFrame(animate);
        }
    });
    requestAnimationFrame(animate);
}

window.onload = function () { main(); }