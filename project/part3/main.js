"use strict";

async function main() {
    // 1. Setup WebGPU
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById("my-canvas");
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    
    context.configure({ device, format, alphaMode: "opaque" });

    // Stencil Format
    const depthStencilFormat = "depth24plus-stencil8";
    const msaaCount = 4;

    const msaaTex = device.createTexture({
        size: [canvas.width, canvas.height],
        format: format,
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const depthTex = device.createTexture({
        size: [canvas.width, canvas.height],
        format: depthStencilFormat,
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // 2. Load Assets
    // Force reload to prevent caching
    const shaderCode = await fetch("shader.wgsl", { cache: "no-store" }).then(r => r.text());
    const shaderModule = device.createShaderModule({ code: shaderCode });

    // Load OBJ
    const objData = await readOBJFile("../textures/teapot.obj", 1, true); 
    
    // Load Texture: EXACTLY AS IN PART 2
    const imgBitmap = await loadBitmap("../textures/xamp23.png");

    // 3. Buffers
    // --- TEAPOT ---
    const tPosBuf = createBuffer(device, flatten(objData.vertices), GPUBufferUsage.VERTEX);
    const tNorBuf = createBuffer(device, flatten(objData.normals), GPUBufferUsage.VERTEX);
    const tIdxBuf = createBuffer(device, objData.indices, GPUBufferUsage.INDEX);
    const tCount  = objData.indices.length;

    // --- GROUND ---
    const gPos = new Float32Array([-2,-1,-1,  2,-1,-1,  2,-1,-5,  -2,-1,-5]);
    const gUV  = new Float32Array([0,0, 1,0, 1,1, 0,1]);
    const gIdx = new Uint32Array([0,1,2, 0,2,3]);
    const gPosBuf = createBuffer(device, gPos, GPUBufferUsage.VERTEX);
    const gUVBuf  = createBuffer(device, gUV, GPUBufferUsage.VERTEX);
    const gIdxBuf = createBuffer(device, gIdx, GPUBufferUsage.INDEX);

    // 4. Uniforms & Bind Groups
    const tUBOSize = 256; 
    const tUBO_Real = device.createBuffer({ size: tUBOSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const tUBO_Refl = device.createBuffer({ size: tUBOSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const gUBO = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // --- TEXTURE SETUP (Restored from Part 2) ---
    const gTex = device.createTexture({
        size: [imgBitmap.width, imgBitmap.height, 1],
        format: "rgba8unorm",
        // Matched usage flags from Part 2 (includes RENDER_ATTACHMENT)
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    
    device.queue.copyExternalImageToTexture(
        { source: imgBitmap, flipY: true }, // Part 2 used flipY: true
        { texture: gTex },
        { width: imgBitmap.width, height: imgBitmap.height }
    );

    const gSamp = device.createSampler({
        magFilter: "linear", minFilter: "linear",
        addressModeU: "repeat", addressModeV: "repeat"
    });

    // --- LAYOUTS ---
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

    // Shared Pipeline Layout
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [tLayout, gLayout] });

    // --- PIPELINES ---

    // 1. MASK PIPELINE (Writes to Stencil only, no color)
    const pipeMask = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: shaderModule, entryPoint: "vs_ground",
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }, 
                { arrayStride: 8,  attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] }
            ]
        },
        fragment: {
            module: shaderModule, entryPoint: "fs_ground",
            targets: [{ format, writeMask: 0 }] // Disable color write
        },
        primitive: { topology: "triangle-list" },
        depthStencil: {
            format: depthStencilFormat,
            depthWriteEnabled: false, 
            depthCompare: "less",
            stencilFront: { compare: "always", passOp: "replace" }, // Write 1 to stencil
            stencilBack: { compare: "always", passOp: "replace" }
        },
        multisample: { count: msaaCount }
    });

    // 2. REFLECTION PIPELINE (Draws ONLY where Stencil == 1)
    const pipeReflect = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: shaderModule, entryPoint: "vs_teapot",
            buffers: [
                { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] },
                { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }] }
            ]
        },
        fragment: { module: shaderModule, entryPoint: "fs_teapot", targets: [{ format }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
            format: depthStencilFormat,
            depthWriteEnabled: true,
            depthCompare: "less",
            stencilFront: { compare: "equal", passOp: "keep" }, // Check if stencil == ref (1)
            stencilBack: { compare: "equal", passOp: "keep" }
        },
        multisample: { count: msaaCount }
    });

    // 3. GROUND PIPELINE (Visible Blend)
    const pipeGround = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: shaderModule, entryPoint: "vs_ground",
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
                { arrayStride: 8,  attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] }
            ]
        },
        fragment: {
            module: shaderModule, entryPoint: "fs_ground",
            targets: [{
                format,
                blend: {
                    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                    alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" }
                }
            }]
        },
        primitive: { topology: "triangle-list" },
        depthStencil: {
            format: depthStencilFormat,
            depthWriteEnabled: true,
            depthCompare: "less"
        },
        multisample: { count: msaaCount }
    });

    // 4. REAL TEAPOT PIPELINE
    const pipeTeapot = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: shaderModule, entryPoint: "vs_teapot",
            buffers: [
                { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] },
                { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }] }
            ]
        },
        fragment: { module: shaderModule, entryPoint: "fs_teapot", targets: [{ format }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
            format: depthStencilFormat,
            depthWriteEnabled: true,
            depthCompare: "less"
        },
        multisample: { count: msaaCount }
    });

    // --- BIND GROUPS ---
    const tBG_Real = device.createBindGroup({ layout: tLayout, entries: [{ binding: 0, resource: { buffer: tUBO_Real } }] });
    const tBG_Refl = device.createBindGroup({ layout: tLayout, entries: [{ binding: 0, resource: { buffer: tUBO_Refl } }] });
    
    const gBG = device.createBindGroup({
        layout: gLayout,
        entries: [
            { binding: 0, resource: { buffer: gUBO } },
            { binding: 1, resource: gSamp },
            { binding: 2, resource: gTex.createView() }
        ]
    });

    // --- SCENE & RENDER LOOP ---
    const eye = vec3(0, 0, 1);
    const at = vec3(0, 0, -3);
    const up = vec3(0, 1, 0);
    const lightPos = vec3(2.0, 2.0, -2.0);
    const R = mult(translate(0, -1, 0), mult(scalem(1, -1, 1), translate(0, 1, 0)));
    
    let jumping = true;
    document.getElementById("toggle-jump").onclick = () => jumping = !jumping;

    function frame(time) {
        const opts = getOptions();
        
        let y = -1.0;
        if (jumping) y = -1.0 + Math.abs(Math.sin(time * 0.002));

        const aspect = canvas.width / canvas.height;
        const P = perspective(65, aspect, 0.1, 50.0);
        const V = lookAt(eye, at, up);

        const M_teapot = mult(translate(0, y, -3), scalem(0.25, 0.25, 0.25));
        const M_refl   = mult(R, M_teapot);
        const MVP_ground = mult(P, mult(V, mat4()));

        updateTeapotUniforms(device, tUBO_Real, P, V, M_teapot, eye, lightPos, opts);
        
        const L_ref_vec4 = mult(R, vec4(lightPos[0], lightPos[1], lightPos[2], 1.0));
        const L_ref = vec3(L_ref_vec4[0], L_ref_vec4[1], L_ref_vec4[2]);
        updateTeapotUniforms(device, tUBO_Refl, P, V, M_refl, eye, L_ref, opts);

        device.queue.writeBuffer(gUBO, 0, flatten(MVP_ground));
        device.queue.writeBuffer(gUBO, 64, new Float32Array([opts.groundAlpha, 0,0,0]));

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: msaaTex.createView(),
                resolveTarget: context.getCurrentTexture().createView(),
                loadOp: "clear", storeOp: "store",
                clearValue: { r: 0.392, g: 0.584, b: 0.929, a: 1.0 }
            }],
            depthStencilAttachment: {
                view: depthTex.createView(),
                depthLoadOp: "clear", depthClearValue: 1.0, depthStoreOp: "store",
                stencilLoadOp: "clear", stencilClearValue: 0, stencilStoreOp: "store"
            }
        });

        // 1. MASK (Stencil = 1)
        pass.setPipeline(pipeMask);
        pass.setStencilReference(1);
        pass.setBindGroup(0, tBG_Real); 
        pass.setBindGroup(1, gBG);      
        pass.setVertexBuffer(0, gPosBuf);
        pass.setVertexBuffer(1, gUVBuf);
        pass.setIndexBuffer(gIdxBuf, "uint32");
        pass.drawIndexed(6);

        // 2. REFLECTION (Draw if Stencil == 1)
        pass.setPipeline(pipeReflect);
        pass.setStencilReference(1);
        pass.setBindGroup(0, tBG_Refl);
        pass.setBindGroup(1, gBG);      
        pass.setVertexBuffer(0, tPosBuf);
        pass.setVertexBuffer(1, tNorBuf);
        pass.setIndexBuffer(tIdxBuf, "uint32");
        pass.drawIndexed(tCount);

        // 3. GROUND (Visible Blend)
        pass.setPipeline(pipeGround);
        pass.setBindGroup(0, tBG_Real);
        pass.setBindGroup(1, gBG);
        pass.setVertexBuffer(0, gPosBuf);
        pass.setVertexBuffer(1, gUVBuf);
        pass.setIndexBuffer(gIdxBuf, "uint32");
        pass.drawIndexed(6);

        // 4. REAL TEAPOT
        pass.setPipeline(pipeTeapot);
        pass.setBindGroup(0, tBG_Real);
        pass.setBindGroup(1, gBG);      
        pass.setVertexBuffer(0, tPosBuf);
        pass.setVertexBuffer(1, tNorBuf);
        pass.setIndexBuffer(tIdxBuf, "uint32");
        pass.drawIndexed(tCount);

        pass.end();
        device.queue.submit([encoder.finish()]);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

function createBuffer(device, data, usage) {
    const buffer = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
}

// RESTORED PART 2 LOADING LOGIC
async function loadBitmap(url) {
    const res = await fetch(url);
    const blob = await res.blob();
    // Re-added colorSpaceConversion: 'none' to match Part 2
    return await createImageBitmap(blob, { colorSpaceConversion: 'none' });
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

function updateTeapotUniforms(device, buffer, P, V, M, eye, lightPos, opts) {
    const MVP = mult(P, mult(V, M));
    const N = transpose(inverse(M)); 
    const data = new Float32Array(64); 
    
    let offset = 0;
    flatten(MVP).forEach(x => data[offset++] = x);
    flatten(M).forEach(x => data[offset++] = x);
    flatten(N).forEach(x => data[offset++] = x);
    
    data[48] = eye[0]; data[49] = eye[1]; data[50] = eye[2]; data[51] = 0;
    data[52] = lightPos[0]; data[53] = lightPos[1]; data[54] = lightPos[2]; data[55] = opts.Le;
    data[56] = opts.La; data[57] = opts.kd; data[58] = opts.ks; data[59] = opts.shin;

    device.queue.writeBuffer(buffer, 0, data);
}

window.onload = main;