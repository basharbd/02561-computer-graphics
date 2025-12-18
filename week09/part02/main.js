"use strict";

// Wire UI sliders to a single callback (update uniforms + redraw).
function setupInputListeners(onchange) {
    document.getElementById('emitted-radiance').oninput = onchange;
    document.getElementById('ambient-radiance').oninput = onchange;
    document.getElementById('diffuse').oninput = onchange;
    document.getElementById('specular').oninput = onchange;
    document.getElementById('shininess').oninput = onchange;
}

// Read current UI values and convert them to numbers for the uniform buffer.
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
    // ---- WebGPU init (adapter/device/canvas/context) ----
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

    // ---- Shared vertex layout for vec4 positions (teapot) ----
    const positionBufferLayout = {
        arrayStride: sizeof['vec4'],
        attributes: [{
            format: 'float32x4',
            offset: 0,
            shaderLocation: 0,
        }],
    };

    // =========================
    // TEAPOT: load OBJ + buffers
    // =========================

    // Load mesh from disk (OBJParser.js)
    const obj_filename = "../textures/teapot.obj";
    const obj = await readOBJFile(obj_filename, 1, true);

    // Position buffer (vec4)
    const teapotPositions = obj.vertices;
    const teapotPositionBuffer = device.createBuffer({
        size: sizeof['vec4'] * teapotPositions.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(teapotPositionBuffer, 0, flatten(teapotPositions));

    // Color buffer (vec4)
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

    // Normal buffer (vec4)
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

    // Index buffer (uint32)
    const teapotIndices = obj.indices;
    const teapotIndicesBuffer = device.createBuffer({
        size: sizeof['vec4'] * teapotIndices.length,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(teapotIndicesBuffer, 0, teapotIndices);

    // Teapot UBO: (mvp, model, eye/light/material params packed in vec4 slots)
    const teapotUniformBuffer = device.createBuffer({
        size: sizeof['mat4'] * 2 + sizeof['vec4'] * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ======================
    // GROUND: quad + UVs + texture
    // ======================

    // Ground quad positions (vec3)
    let positionsGround = [
        vec3(-2, -1, -1),
        vec3(2, -1, -1),
        vec3(2, -1, -5),
        vec3(-2, -1, -5),
    ];

    // Ground indices (two triangles)
    let indicesGround = new Uint32Array([
        0, 1, 2,
        0, 2, 3,
    ]);

    // Ground position buffer
    const groundPositionBuffer = device.createBuffer({
        size: sizeof['vec3'] * positionsGround.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Vertex layout for ground vec3 positions
    const groundPositionBufferLayout = {
        arrayStride: sizeof['vec3'],
        attributes: [{
            format: 'float32x3',
            offset: 0,
            shaderLocation: 0,
        }],
    };

    // Ground index buffer
    const groundIndicesBuffer = device.createBuffer({
        size: sizeof['vec3'] * indicesGround.length,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });

    // Ground UVs (bound at shaderLocation 3 in WGSL)
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

    // Upload ground geometry to GPU
    device.queue.writeBuffer(groundPositionBuffer, 0, flatten(positionsGround));
    device.queue.writeBuffer(groundIndicesBuffer, 0, indicesGround);
    device.queue.writeBuffer(groundTexcoordBuffer, 0, flatten(groundTexcoords));

    // Load ground texture image
    const filename = '../textures/xamp23.png';
    const response = await fetch(filename);
    const blob = await response.blob();
    const img = await createImageBitmap(blob, { colorSpaceConversion: 'none' });

    // Create GPU texture and copy pixels in
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

    // Sampler for the ground texture (simple clamp + linear)
    groundTexture.sampler = device.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        minFilter: 'linear',
        magFilter: 'linear',
    });

    // Clear color for the render pass
    const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0);

    // Ground UBO (mvp + (extra data packed as vec4s))
    const groundUniformBuffer = device.createBuffer({
        size: sizeof['mat4'] * 2 + sizeof['vec4'] * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Shadow UBO (mvpShadow + same packing style as ground UBO)
    const uniformBufferShadow = device.createBuffer({
        size: sizeof['mat4'] * 2 + sizeof['vec4'] * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ---- Clip-space depth fix for WebGPU (OpenGL-style -> [0,1]) ----
    const Mst = mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    );

    // Model transform for the shared scene origin
    const center = translate(0, 0, 0);
    const M = center;

    // Projection (perspective) with depth fix applied
    const fov = 90;
    let projection = perspective(fov, canvas.width / canvas.height, 1, 20);
    projection = mult(Mst, projection);

    // View is identity here
    const V = mat4();

    // MVP for the ground pass (static in this setup)
    const mvp = mult(projection, mult(V, M));

    // Initialize ground uniforms
    device.queue.writeBuffer(groundUniformBuffer, 0, flatten(mvp));
    device.queue.writeBuffer(groundUniformBuffer, sizeof['mat4'] * 2, new Float32Array([0.0, 0.0, 0.0, 1.0]));

    // ---- Load WGSL and create shader module ----
    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({
        code: wgslcode
    });

    // ---- MSAA configuration ----
    const msaaCount = 4;

    // =======================
    // Pipelines (ground / teapot / shadow)
    // =======================

    // Ground pipeline: textured quad
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

    // Teapot pipeline: lit mesh (Phong)
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

    // Shadow pipeline: draws the projected teapot shadow geometry
    const pipelineShadows = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs_shadow',
            buffers: [positionBufferLayout],
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs_shadow',
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

    // ---- MSAA color target + depth target ----
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

    // =======================
    // Bind groups (ground / teapot / shadow)
    // =======================

    // Ground uses: ground UBO + ground texture sampler/view
    const groundBindGroup = device.createBindGroup({
        layout: groundPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: groundUniformBuffer } },
            { binding: 1, resource: groundTexture.sampler },
            { binding: 2, resource: groundTexture.createView() },
        ],
    });

    // Teapot uses: teapot UBO (lighting + transforms)
    const teapotBindGroup = device.createBindGroup({
        layout: teapotPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: teapotUniformBuffer } },
        ],
    });

    // Shadow uses: shadow UBO (shadow MVP)
    const bindGroupShadows = device.createBindGroup({
        layout: pipelineShadows.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: uniformBufferShadow } },
        ],
    });

    // ---- UI toggles for light/teapot animation ----
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

    // ---- Animation state ----
    let lastTime = performance.now();
    let animateLight = false;
    let animateTeapot = false;

    // Light moves on a circle above the ground
    let lightAngle = 0;
    const lightRadius = 2.0;
    let lightPos = vec3(lightRadius * Math.sin(lightAngle), 2, -2 + lightRadius * Math.cos(lightAngle));

    function updateLightPosition(timestamp) {
        lightAngle += (timestamp - lastTime) * 0.0025;
        lightPos = vec3(lightRadius * Math.sin(lightAngle), 2, -2 + lightRadius * Math.cos(lightAngle));
    }

    // Teapot moves up and down between y=-1 and y=-0.5
    let teapotY = -1;
    let direction = 1;
    let M_teapot = mult(translate(0, teapotY, -3), scalem(0.25, 0.25, 0.25));
    let mvp_teapot = mult(projection, mult(V, M_teapot));
    const eye = vec3(0, 0, 0);

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
    }

    // Shadow MVP cached per frame
    let mvpShadow = mat4();

    function computeShadowMatrix() {
        // Small lift to avoid z-fighting between shadow polygons and the ground
        const epsilon = 0.001;

        // Planar projection shadow matrix (point light onto plane y=-1)
        const l = lightPos;
        const n = vec3(0, 1, 0);
        const d = 1.0 + epsilon;

        const a = d + dot(n, l);
        const Mshadow = mat4(
            a - l[0] * n[0], -l[0] * n[1], -l[0] * n[2], -l[0] * d,
            -l[1] * n[0], a - l[1] * n[1], -l[1] * n[2], -l[1] * d,
            -l[2] * n[0], -l[2] * n[1], a - l[2] * n[2], -l[2] * d,
            -n[0], -n[1], -n[2], a - d
        );

        // Apply model first, then shadow projection, then view/projection
        const mvpShadow = mult(projection, mult(V, mult(Mshadow, M_teapot)));
        return mvpShadow;
    }

    function updateUniforms() {
        // Pull latest slider values (Le/La/kd/ks/shininess)
        const options = getOptions();

        // Pack lighting params in the same order expected by WGSL Uniforms struct
        const teapotUniforms = new Float32Array([
            ...flatten(eye), 1.0,
            ...flatten(lightPos), options.emittedRadianceSlider,
            options.ambientRadianceSlider, options.diffuseSlider, options.specularSlider, options.shininessSlider,
        ]);

        // Upload teapot transforms + lighting params
        device.queue.writeBuffer(teapotUniformBuffer, 0, flatten(mvp_teapot));
        device.queue.writeBuffer(teapotUniformBuffer, sizeof['mat4'], flatten(M_teapot));
        device.queue.writeBuffer(teapotUniformBuffer, sizeof['mat4'] * 2, teapotUniforms);

        // Upload shadow MVP when available
        if (mvpShadow) {
            device.queue.writeBuffer(uniformBufferShadow, 0, flatten(mvpShadow));
        }
    }

    function animate(timestamp) {
        // Update moving parts first (light/teapot), then recompute shadow MVP
        if (animateLight) {
            updateLightPosition(timestamp);
        }
        if (animateTeapot) {
            updateTeatpotPosition(timestamp);
        }
        mvpShadow = computeShadowMatrix();

        // Advance time, update GPU uniforms, then draw
        lastTime = timestamp;
        updateUniforms();
        render();

        // Continue animation loop only while something is animating
        if (animateLight || animateTeapot) {
            requestAnimationFrame(animate);
        }
    }

    function render() {
        // Start command recording
        const encoder = device.createCommandEncoder();

        // Render pass: MSAA color + depth
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

        // 1) Ground pass (textured)
        pass.setPipeline(groundPipeline);
        pass.setIndexBuffer(groundIndicesBuffer, 'uint32');
        pass.setVertexBuffer(0, groundPositionBuffer);
        pass.setVertexBuffer(1, groundTexcoordBuffer);
        pass.setBindGroup(0, groundBindGroup);
        pass.drawIndexed(6);

        // 2) Shadow pass (projected teapot geometry)
        pass.setPipeline(pipelineShadows);
        pass.setIndexBuffer(teapotIndicesBuffer, 'uint32');
        pass.setVertexBuffer(0, teapotPositionBuffer);
        pass.setBindGroup(0, bindGroupShadows);
        pass.drawIndexed(teapotIndices.length);

        // 3) Teapot pass (lit mesh)
        pass.setPipeline(teapotPipeline);
        pass.setVertexBuffer(0, teapotPositionBuffer);
        pass.setVertexBuffer(1, teapotColorBuffer);
        pass.setVertexBuffer(2, teapotNormalBuffer);
        pass.setBindGroup(0, teapotBindGroup);
        pass.drawIndexed(teapotIndices.length);

        // Finish pass + submit
        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    // Slider changes: render a frame if nothing is currently animating
    setupInputListeners(() => {
        if (!(animateLight || animateTeapot)) {
            requestAnimationFrame(animate);
        }
    });

    // Initial frame
    mvpShadow = computeShadowMatrix();
    updateUniforms();
    requestAnimationFrame(animate);
}

window.onload = function () { main(); }
