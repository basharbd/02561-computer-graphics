"use strict";

function setupInputListeners(onchange) {
    // UI sliders: any change should trigger a redraw / uniform update
    document.getElementById('emitted-radiance').oninput = onchange;
    document.getElementById('ambient-radiance').oninput = onchange;
    document.getElementById('diffuse').oninput = onchange;
    document.getElementById('specular').oninput = onchange;
    document.getElementById('shininess').oninput = onchange;
}

function getOptions() {
    // Read current UI values (convert slider strings -> numbers)
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
    // WebGPU setup: adapter -> device -> canvas context
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

    // ---------------------------
    // Shared vertex layout (vec4)
    // ---------------------------
    const positionBufferLayout = {
        arrayStride: sizeof['vec4'],
        attributes: [{
            format: 'float32x4',
            offset: 0,
            shaderLocation: 0,
        }],
    };

    // ===========================
    // TEAPOT (OBJ mesh)
    // ===========================
    const obj_filename = "../textures/teapot.obj";
    const obj = await readOBJFile(obj_filename, 1, true);

    // Vertex positions (vec4 per vertex)
    const teapotPositions = obj.vertices;
    const teapotPositionBuffer = device.createBuffer({
        size: sizeof['vec4'] * teapotPositions.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(teapotPositionBuffer, 0, flatten(teapotPositions));

    // Vertex colors (vec4 per vertex)
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

    // Vertex normals (vec4 per vertex)
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

    // Triangle index buffer (uint32)
    const teapotIndices = obj.indices;
    const teapotIndicesBuffer = device.createBuffer({
        size: sizeof['vec4'] * teapotIndices.length,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(teapotIndicesBuffer, 0, teapotIndices);

    // Teapot uniforms: MVP + Model + extra parameters (eye/light/material)
    const teapotUniformBuffer = device.createBuffer({
        size: sizeof['mat4'] * 2 + sizeof['vec4'] * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ===========================
    // GROUND (textured quad)
    // ===========================
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

    // Ground positions (vec3)
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

    // Ground indices
    const groundIndicesBuffer = device.createBuffer({
        size: sizeof['vec3'] * indicesGround.length,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });

    // Ground UVs (vec2) -> shaderLocation 3 (matches your WGSL)
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

    // Ground texture (xamp23.png)
    const filename = '../textures/xamp23.png';
    const response = await fetch(filename);
    if (!response.ok) throw new Error("Failed to load texture " + filename);
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

    // Sampler for ground texture (clamp + linear)
    groundTexture.sampler = device.createSampler({
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        minFilter: 'linear',
        magFilter: 'linear',
    });

    // Clear color
    const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0);

    // Ground uniforms: (MVP + extra matrices/params as your WGSL expects)
    const groundUniformBuffer = device.createBuffer({
        size: sizeof['mat4'] * 2 + 4 * sizeof['vec4'],
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Depth remap matrix (WebGPU clip z -> [0,1])
    const Mst = mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    )

    // Scene/model transform (identity translate)
    const center = translate(0, 0, 0);
    const M = center;

    // Projection (perspective) with depth fix
    const fov = 90;
    let projection = perspective(fov, canvas.width / canvas.height, 1, 20);
    projection = mult(Mst, projection);

    // View matrix (identity here)
    const V = mat4();

    // MVP used by ground
    const mvp = mult(projection, mult(V, M));

    // Upload ground uniforms (MVP + placeholders/params)
    device.queue.writeBuffer(groundUniformBuffer, 0, flatten(mvp));
    device.queue.writeBuffer(groundUniformBuffer, sizeof['mat4'] * 2, new Float32Array([0.0, 0.0, 0.0, 1.0]));

    // ===========================
    // Shader + pipelines
    // ===========================
    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({ code: wgslcode });

    const msaaCount = 4;

    // Ground pipeline (textured quad)
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

    // Teapot pipeline (Phong shading in WGSL)
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

    // MSAA color + depth textures
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

    // ===========================
    // Bind groups
    // ===========================
    const groundBindGroup = device.createBindGroup({
        layout: groundPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: groundUniformBuffer } },
            { binding: 1, resource: groundTexture.sampler },
            { binding: 2, resource: groundTexture.createView() },
        ],
    });

    const teapotBindGroup = device.createBindGroup({
        layout: teapotPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: teapotUniformBuffer } },
        ],
    });

    // ===========================
    // Animation toggles
    // ===========================
    document.getElementById('toggle-animate-light').onclick = () => {
        animateLight = !animateLight;
        // If only light started, kick the RAF loop
        if (animateLight && !animateTeapot) {
            lastTime = performance.now();
            requestAnimationFrame(animate);
        }
    };

    document.getElementById('toggle-animate-teapot').onclick = () => {
        animateTeapot = !animateTeapot;
        // If only teapot started, kick the RAF loop
        if (animateTeapot && !animateLight) {
            lastTime = performance.now();
            requestAnimationFrame(animate);
        }
    };

    let lastTime = performance.now();
    let animateLight = false;
    let animateTeapot = false;

    // Light (moves on a circle)
    let lightAngle = 90;
    const lightRadius = 2.0;
    let lightPos = vec3(lightRadius * Math.sin(lightAngle), 2, -2 + lightRadius * Math.cos(lightAngle));

    function updateLightPosition(timestamp) {
        // Advance angle based on time delta
        lightAngle += (timestamp - lastTime) * 0.0025;
        lightPos = vec3(lightRadius * Math.sin(lightAngle), 2, -2 + lightRadius * Math.cos(lightAngle));
    }

    // Teapot vertical motion (bounces between y=-1 and y=-0.5)
    let teapotY = -1;
    let direction = 1;
    let M_teapot = mult(translate(0, teapotY, -3), scalem(0.25, 0.25, 0.25));
    let mvp_teapot = mult(projection, mult(V, M_teapot));
    const eye = vec3(0, 0, 0);

    function updateTeatpotPosition(timestamp) {
        // Simple bounce motion using dt
        teapotY = teapotY + direction * 0.0005 * (timestamp - lastTime);

        if (teapotY < -1.0) {
            teapotY = -1.0;
            direction = 1;
        }
        else if (teapotY > -0.5) {
            teapotY = -0.5;
            direction = -1;
        }

        // Rebuild model + MVP for teapot
        M_teapot = mult(translate(0, teapotY, -3), scalem(0.25, 0.25, 0.25));
        mvp_teapot = mult(projection, mult(V, M_teapot));
    }

    function updateUniforms() {
        // Pack lighting/material sliders into the UBO tail
        const options = getOptions();

        const teapotUniforms = new Float32Array([
            ...flatten(eye), 1.0,                          // eye (vec3 + pad)
            ...flatten(lightPos), options.emittedRadianceSlider, // light position + L_e
            options.ambientRadianceSlider,                 // L_a
            options.diffuseSlider,                         // k_d
            options.specularSlider,                        // k_s
            options.shininessSlider,                       // shininess
        ]);

        // UBO layout: [mvp][model][params...]
        device.queue.writeBuffer(teapotUniformBuffer, 0, flatten(mvp_teapot));
        device.queue.writeBuffer(teapotUniformBuffer, sizeof['mat4'], flatten(M_teapot));
        device.queue.writeBuffer(teapotUniformBuffer, sizeof['mat4'] * 2, teapotUniforms);
    }

    function animate(timestamp) {
        // Update animated state (light/teapot) then draw
        if (animateLight) {
            updateLightPosition(timestamp);
        }
        if (animateTeapot) {
            updateTeatpotPosition(timestamp);
        }

        lastTime = timestamp;
        updateUniforms();
        render();

        // Keep looping only while at least one animation is active
        if (animateLight || animateTeapot) {
            requestAnimationFrame(animate);
        }
    }

    function render() {
        // Single render pass: draw ground first, then teapot
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

        // Ground draw (textured)
        pass.setPipeline(groundPipeline);
        pass.setIndexBuffer(groundIndicesBuffer, 'uint32');
        pass.setVertexBuffer(0, groundPositionBuffer);
        pass.setVertexBuffer(1, groundTexcoordBuffer);
        pass.setBindGroup(0, groundBindGroup);
        pass.drawIndexed(6);

        // Teapot draw (lit mesh)
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

    // Any UI change updates uniforms and triggers a redraw (without forcing full animation)
    setupInputListeners(() => {
        if (!(animateLight || animateTeapot)) {
            requestAnimationFrame(animate);
        }
    });

    // Initial frame
    requestAnimationFrame(animate);
}

window.onload = function () { main(); }
