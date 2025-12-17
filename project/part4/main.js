"use strict";

// --- Helpers ---

// EXACTLY AS IN PART 2
async function loadBitmap(url) {
    const res = await fetch(url);
    const blob = await res.blob();
    return await createImageBitmap(blob, { colorSpaceConversion: 'none' });
}

function makeBuffer(device, typedArray, usage) {
    const buf = device.createBuffer({
        size: typedArray.byteLength,
        usage: usage | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buf, 0, typedArray);
    return buf;
}

function reflectionYMinus1() {
    return mult(translate(0, -1, 0), mult(scalem(1, -1, 1), translate(0, 1, 0)));
}

// Lengyel's Oblique Near-Plane Clipping Matrix Modification
function modifyProjectionMatrix(clipplane, projection) {
    // Clone projection to avoid modifying the original
    var oblique = [];
    for(let i=0; i<4; i++) oblique.push([...projection[i]]);
    oblique.matrix = true;

    var q = vec4(
        (Math.sign(clipplane[0]) + projection[0][2]) / projection[0][0],
        (Math.sign(clipplane[1]) + projection[1][2]) / projection[1][1],
        -1.0,
        (1.0 + projection[2][2]) / projection[2][3]
    );

    var s = 2.0 / dot(clipplane, q);

    // Replace third row (index 2)
    oblique[2] = vec4(
        clipplane[0] * s,
        clipplane[1] * s,
        clipplane[2] * s + 1.0,
        clipplane[3] * s
    );

    return oblique;
}

function getOptions() {
    return {
        Le: parseFloat(document.getElementById("emitted-radiance").value),
        La: parseFloat(document.getElementById("ambient-radiance").value),
        kd: parseFloat(document.getElementById("diffuse").value),
        ks: parseFloat(document.getElementById("specular").value),
        shin: parseFloat(document.getElementById("shininess").value),
        groundAlpha: parseFloat(document.getElementById("ground-alpha").value),
    };
}

function updateTeapotUBO(device, ubo, P, V, M, eye, lightPos, opts) {
    const MVP = mult(P, mult(V, M));
    const N = transpose(inverse(M));
    const data = new Float32Array(64);
    data.set(flatten(MVP), 0);
    data.set(flatten(M), 16);
    data.set(flatten(N), 32);
    data.set([eye[0], eye[1], eye[2], 1.0], 48);
    data.set([lightPos[0], lightPos[1], lightPos[2], opts.Le], 52);
    data.set([opts.La, opts.kd, opts.ks, opts.shin], 56);
    device.queue.writeBuffer(ubo, 0, data);
}

async function main() {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return alert("WebGPU not supported");
    const device = await adapter.requestDevice();
    const canvas = document.getElementById("my-canvas");
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    const depthStencilFormat = "depth24plus-stencil8";
    const msaaCount = 4;

    const msaaTex = device.createTexture({
        size: [canvas.width, canvas.height],
        format,
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const depthTex = device.createTexture({
        size: [canvas.width, canvas.height],
        format: depthStencilFormat,
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Cache busting for Shader
    const shaderCode = await fetch("shader.wgsl", { cache: "no-store" }).then(r => r.text());
    const shaderModule = device.createShaderModule({ code: shaderCode });

    // 1. Geometry
    const obj = await readOBJFile("../textures/teapot.obj", 1, true);
    const tPosBuf = makeBuffer(device, flatten(obj.vertices), GPUBufferUsage.VERTEX);
    const tNorBuf = makeBuffer(device, flatten(obj.normals), GPUBufferUsage.VERTEX);
    const tIdxBuf = makeBuffer(device, new Uint32Array(obj.indices), GPUBufferUsage.INDEX);
    const tIndexCount = obj.indices.length;

    const groundPositions = new Float32Array([-2,-1,-1,  2,-1,-1,  2,-1,-5, -2,-1,-5]);
    const groundUVs = new Float32Array([0,0, 1,0, 1,1, 0,1]);
    const groundIndices = new Uint32Array([0, 1, 2, 0, 2, 3]);

    const gPosBuf = makeBuffer(device, groundPositions, GPUBufferUsage.VERTEX);
    const gUVBuf = makeBuffer(device, groundUVs, GPUBufferUsage.VERTEX);
    const gIdxBuf = makeBuffer(device, groundIndices, GPUBufferUsage.INDEX);

    // 2. Texture - STRICTLY MATCHING PART 2
    const img = await loadBitmap("../textures/xamp23.png");
    const gTex = device.createTexture({
        size: [img.width, img.height, 1],
        format: "rgba8unorm",
        // Matched usage flags from Part 2 (includes RENDER_ATTACHMENT)
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture(
        { source: img, flipY: true }, // Part 2 used flipY: true
        { texture: gTex },
        { width: img.width, height: img.height }
    );
    const gSampler = device.createSampler({
        addressModeU: "repeat", addressModeV: "repeat",
        minFilter: "linear", magFilter: "linear",
    });

    // 3. Layouts & Bind Groups
    // Group 0: Teapot Uniforms
    const tLayout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }]
    });
    // Group 1: Ground Uniforms + Texture
    const gLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} }
        ]
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [tLayout, gLayout] });

    const tUBO_real = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const tUBO_refl = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const gUBO = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const tBG_real = device.createBindGroup({ layout: tLayout, entries: [{ binding: 0, resource: { buffer: tUBO_real } }] });
    const tBG_refl = device.createBindGroup({ layout: tLayout, entries: [{ binding: 0, resource: { buffer: tUBO_refl } }] });
    const gBG = device.createBindGroup({
        layout: gLayout,
        entries: [
            { binding: 0, resource: { buffer: gUBO } },
            { binding: 1, resource: gSampler },
            { binding: 2, resource: gTex.createView() },
        ],
    });

    const teapotBuffers = [
        { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }] }
    ];
    const groundBuffers = [
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
        { arrayStride: 8,  attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] }
    ];

    // --- PIPELINES ---
    // 1. Mask Pipeline (Write Stencil=1, No Color)
    const pipeMask = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: shaderModule, entryPoint: "vs_ground", buffers: groundBuffers },
        fragment: { module: shaderModule, entryPoint: "fs_mask", targets: [{ format, writeMask: 0 }] },
        primitive: { topology: "triangle-list" },
        multisample: { count: msaaCount },
        depthStencil: {
            format: depthStencilFormat,
            depthWriteEnabled: false, depthCompare: "less",
            stencilFront: { compare: "always", passOp: "replace" },
            stencilBack: { compare: "always", passOp: "replace" }
        }
    });

    // 2. Reflect Pipeline (Draw where Stencil==1)
    const pipeReflect = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: shaderModule, entryPoint: "vs_teapot", buffers: teapotBuffers },
        fragment: { module: shaderModule, entryPoint: "fs_teapot", targets: [{ format }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        multisample: { count: msaaCount },
        depthStencil: {
            format: depthStencilFormat,
            depthWriteEnabled: true, depthCompare: "less",
            stencilFront: { compare: "equal", passOp: "keep" },
            stencilBack: { compare: "equal", passOp: "keep" }
        }
    });

    // 3. Ground Pipeline (Blend)
    const pipeGround = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: shaderModule, entryPoint: "vs_ground", buffers: groundBuffers },
        fragment: {
            module: shaderModule, entryPoint: "fs_ground",
            targets: [{
                format,
                blend: {
                    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
                }
            }]
        },
        primitive: { topology: "triangle-list" },
        multisample: { count: msaaCount },
        depthStencil: {
            format: depthStencilFormat,
            depthWriteEnabled: true, depthCompare: "less",
        }
    });

    // 4. Real Teapot Pipeline
    const pipeTeapot = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: shaderModule, entryPoint: "vs_teapot", buffers: teapotBuffers },
        fragment: { module: shaderModule, entryPoint: "fs_teapot", targets: [{ format }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        multisample: { count: msaaCount },
        depthStencil: {
            format: depthStencilFormat,
            depthWriteEnabled: true, depthCompare: "less",
        }
    });

    // --- Render Loop ---
    const depthFix = mat4(1,0,0,0, 0,1,0,0, 0,0,0.5,0.5, 0,0,0,1);
    const eye = vec3(0, 0, 1);
    const at = vec3(0, 0, -3);
    const up = vec3(0, 1, 0);
    const lightPos = vec3(2.0, 2.0, -2.0);
    const R = reflectionYMinus1();

    let jumping = true;
    document.getElementById("toggle-jump").onclick = () => (jumping = !jumping);

    function frame(t_ms) {
        const opts = getOptions();
        const aspect = canvas.width / canvas.height;
        // Standard Projection
        const P = mult(depthFix, perspective(65, aspect, 0.1, 50.0));
        const V = lookAt(eye, at, up);

        // --- Oblique Clipping Setup ---
        // Reflector Plane in World: y = -1  =>  0x + 1y + 0z + 1 = 0
        const planeWorld = vec4(0, 1, 0, 1);
        // Transform plane to Eye Space
        const V_inv_trans = transpose(inverse(V));
        const planeEye = mult(V_inv_trans, planeWorld);
        // Modify Projection for Reflection
        const P_oblique = modifyProjectionMatrix(planeEye, P);

        // Animation
        let y = -1.8; 
        if (jumping) y = -1.8 + 1.8 * Math.abs(Math.sin(t_ms * 0.001));
        
        const M = mult(translate(0, y, -3), scalem(0.25, 0.25, 0.25));
        const Mrefl = mult(R, M);
        const L4 = mult(R, vec4(lightPos[0], lightPos[1], lightPos[2], 1.0));
        const lightRefl = vec3(L4[0], L4[1], L4[2]);

        // Update UBOs
        updateTeapotUBO(device, tUBO_real, P, V, M, eye, lightPos, opts);
        updateTeapotUBO(device, tUBO_refl, P_oblique, V, Mrefl, eye, lightRefl, opts);

        const MVPg = mult(P, mult(V, mat4()));
        device.queue.writeBuffer(gUBO, 0, flatten(MVPg));
        device.queue.writeBuffer(gUBO, 64, new Float32Array([opts.groundAlpha, 0, 0, 0]));

        const encoder = device.createCommandEncoder();
        
        // --- Pass 1: Mask + Reflection ---
        const pass1 = encoder.beginRenderPass({
            colorAttachments: [{
                view: msaaTex.createView(),
                resolveTarget: context.getCurrentTexture().createView(),
                loadOp: "clear", storeOp: "store",
                clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 },
            }],
            depthStencilAttachment: {
                view: depthTex.createView(),
                depthLoadOp: "clear", depthClearValue: 1.0, depthStoreOp: "store",
                stencilLoadOp: "clear", stencilClearValue: 0, stencilStoreOp: "store",
            }
        });

        // 1. Mask
        pass1.setPipeline(pipeMask);
        pass1.setStencilReference(1);
        pass1.setBindGroup(0, tBG_real); pass1.setBindGroup(1, gBG);
        pass1.setVertexBuffer(0, gPosBuf); pass1.setVertexBuffer(1, gUVBuf); pass1.setIndexBuffer(gIdxBuf, "uint32");
        pass1.drawIndexed(6);

        // 2. Reflect
        pass1.setPipeline(pipeReflect);
        pass1.setStencilReference(1);
        pass1.setBindGroup(0, tBG_refl); pass1.setBindGroup(1, gBG);
        pass1.setVertexBuffer(0, tPosBuf); pass1.setVertexBuffer(1, tNorBuf); pass1.setIndexBuffer(tIdxBuf, "uint32");
        pass1.drawIndexed(tIndexCount);
        
        pass1.end();

        // --- Pass 2: Ground + Real Object ---
        const pass2 = encoder.beginRenderPass({
            colorAttachments: [{
                view: msaaTex.createView(),
                resolveTarget: context.getCurrentTexture().createView(),
                loadOp: "load", storeOp: "store", 
            }],
            depthStencilAttachment: {
                view: depthTex.createView(),
                depthLoadOp: "clear", depthClearValue: 1.0, depthStoreOp: "store", 
                stencilLoadOp: "load", stencilStoreOp: "store",
            }
        });

        // 3. Ground
        pass2.setPipeline(pipeGround);
        pass2.setBindGroup(0, tBG_real); pass2.setBindGroup(1, gBG);
        pass2.setVertexBuffer(0, gPosBuf); pass2.setVertexBuffer(1, gUVBuf); pass2.setIndexBuffer(gIdxBuf, "uint32");
        pass2.drawIndexed(6);

        // 4. Real Teapot
        pass2.setPipeline(pipeTeapot);
        pass2.setBindGroup(0, tBG_real); pass2.setBindGroup(1, gBG);
        pass2.setVertexBuffer(0, tPosBuf); pass2.setVertexBuffer(1, tNorBuf); pass2.setIndexBuffer(tIdxBuf, "uint32");
        pass2.drawIndexed(tIndexCount);

        pass2.end();

        device.queue.submit([encoder.finish()]);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
window.onload = main;