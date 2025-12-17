"use strict";

async function main() {
    // 1. Setup WebGPU
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById("my-canvas");
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    
    context.configure({ device, format, alphaMode: "opaque" });

    // Multisample and Depth Textures
    const msaaCount = 4;
    const msaaTex = device.createTexture({
        size: [canvas.width, canvas.height],
        format: format,
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const depthTex = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // 2. Load Shader & Assets
    const shaderCode = await fetch("shader.wgsl").then(r => r.text());
    const shaderModule = device.createShaderModule({ code: shaderCode });

    // Load Teapot OBJ
    const objData = await readOBJFile("../textures/teapot.obj", 1, true); 

    // Load Ground Texture
    const imgBitmap = await loadBitmap("../textures/xamp23.png");

    // 3. Create Buffers (Geometry)
    
    // --- TEAPOT ---
    const teapotPosBuf = createBuffer(device, flatten(objData.vertices), GPUBufferUsage.VERTEX);
    const teapotNorBuf = createBuffer(device, flatten(objData.normals), GPUBufferUsage.VERTEX);
    const teapotIdxBuf = createBuffer(device, objData.indices, GPUBufferUsage.INDEX);
    const teapotIndexCount = objData.indices.length;

    // --- GROUND ---
    const groundPos = new Float32Array([
        -2, -1, -1,  // BL
         2, -1, -1,  // BR
         2, -1, -5,  // TR
        -2, -1, -5   // TL
    ]);
    const groundUV = new Float32Array([
        0, 0,  1, 0,  1, 1,  0, 1
    ]);
    const groundIdx = new Uint32Array([0, 1, 2, 0, 2, 3]);

    const groundPosBuf = createBuffer(device, groundPos, GPUBufferUsage.VERTEX);
    const groundUVBuf  = createBuffer(device, groundUV, GPUBufferUsage.VERTEX);
    const groundIdxBuf = createBuffer(device, groundIdx, GPUBufferUsage.INDEX);

    // 4. Uniforms & BindGroups

    // Ground Texture & Sampler
    const groundTex = device.createTexture({
        size: [imgBitmap.width, imgBitmap.height, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture({ source: imgBitmap, flipY: true }, { texture: groundTex }, { width: imgBitmap.width, height: imgBitmap.height });

    const groundSampler = device.createSampler({
        magFilter: "linear", minFilter: "linear",
        addressModeU: "repeat", addressModeV: "repeat"
    });

    // Uniform Buffers
    const teapotUBOSize = 240;
    const teapotUBO_Real = device.createBuffer({ size: teapotUBOSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const teapotUBO_Refl = device.createBuffer({ size: teapotUBOSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const groundUBO = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // 5. Pipelines

    // --- GROUND PIPELINE (Group 0) ---
    const groundPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: shaderModule, entryPoint: "vs_ground",
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }, // Pos
                { arrayStride: 8,  attributes: [{ shaderLocation: 1, offset: 0, format: "float32x2" }] }  // UV
            ]
        },
        fragment: {
            module: shaderModule, entryPoint: "fs_ground",
            targets: [{
                format: format,
                blend: {
                    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                    alpha: { srcFactor: "zero",      dstFactor: "one",                 operation: "add" }
                }
            }]
        },
        primitive: { topology: "triangle-list" },
        depthStencil: {
            depthWriteEnabled: true, 
            depthCompare: "less", 
            format: "depth24plus"
        },
        multisample: { count: msaaCount }
    });

    const groundBindGroup = device.createBindGroup({
        layout: groundPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: groundUBO } },
            { binding: 1, resource: groundSampler },
            { binding: 2, resource: groundTex.createView() }
        ]
    });

    // --- TEAPOT PIPELINE (Group 1) ---
    const emptyLayout = device.createBindGroupLayout({ entries: [] });
    const teapotLayout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }]
    });

    const teapotPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [emptyLayout, teapotLayout] }),
        vertex: {
            module: shaderModule, entryPoint: "vs_teapot",
            buffers: [
                { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] }, // Pos
                { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }] }  // Nor
            ]
        },
        fragment: {
            module: shaderModule, entryPoint: "fs_teapot",
            targets: [{ format: format }]
        },
        primitive: { 
            topology: "triangle-list",
            cullMode: "none" 
        },
        depthStencil: { depthWriteEnabled: true, depthCompare: "less", format: "depth24plus" },
        multisample: { count: msaaCount }
    });

    const teapotBG_Real = device.createBindGroup({ layout: teapotLayout, entries: [{ binding: 0, resource: { buffer: teapotUBO_Real } }] });
    const teapotBG_Refl = device.createBindGroup({ layout: teapotLayout, entries: [{ binding: 0, resource: { buffer: teapotUBO_Refl } }] });

    // 6. Scene Variables
    const eye = vec3(0, 0, 1);
    const at = vec3(0, 0, -3);
    const up = vec3(0, 1, 0);
    const lightPosInitial = vec3(2.0, 2.0, -2.0);

    let jumping = true;
    document.getElementById("toggle-jump").onclick = () => { jumping = !jumping; };

    const R = mult(translate(0, -1, 0), mult(scalem(1, -1, 1), translate(0, 1, 0)));

    function frame(time) {
        // --- 1. Update State ---
        const options = getOptions();
        
        let yPos = -1.0;
        if (jumping) {
            yPos = -1.0 + Math.abs(Math.sin(time * 0.002));
        }

        const aspect = canvas.width / canvas.height;
        const P = perspective(65, aspect, 0.1, 50.0);
        const V = lookAt(eye, at, up);
        
        const M_teapot = mult(translate(0, yPos, -3), scalem(0.25, 0.25, 0.25));
        const M_reflected = mult(R, M_teapot);

        // --- 2. Update Uniforms ---
        updateTeapotUniforms(device, teapotUBO_Real, P, V, M_teapot, eye, lightPosInitial, options);

        const L_ref_vec4 = mult(R, vec4(lightPosInitial[0], lightPosInitial[1], lightPosInitial[2], 1.0));
        const L_ref = vec3(L_ref_vec4[0], L_ref_vec4[1], L_ref_vec4[2]);
        updateTeapotUniforms(device, teapotUBO_Refl, P, V, M_reflected, eye, L_ref, options);

        const VP = mult(P, V);
        device.queue.writeBuffer(groundUBO, 0, flatten(VP)); 
        device.queue.writeBuffer(groundUBO, 64, new Float32Array([options.groundAlpha, 0, 0, 0]));

        // --- 3. Render ---
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: msaaTex.createView(),
                resolveTarget: context.getCurrentTexture().createView(),
                loadOp: "clear", storeOp: "store",
                // CHANGED: Blue background (Cornflower Blue)
                clearValue: { r: 0.392, g: 0.584, b: 0.929, a: 1.0 }
            }],
            depthStencilAttachment: {
                view: depthTex.createView(),
                depthLoadOp: "clear", depthClearValue: 1.0, depthStoreOp: "store"
            }
        });

        // 1. Reflected Teapot
        pass.setPipeline(teapotPipeline);
        pass.setBindGroup(1, teapotBG_Refl);
        pass.setVertexBuffer(0, teapotPosBuf);
        pass.setVertexBuffer(1, teapotNorBuf);
        pass.setIndexBuffer(teapotIdxBuf, "uint32");
        pass.drawIndexed(teapotIndexCount);

        // 2. Ground 
        pass.setPipeline(groundPipeline);
        pass.setBindGroup(0, groundBindGroup);
        pass.setVertexBuffer(0, groundPosBuf);
        pass.setVertexBuffer(1, groundUVBuf);
        pass.setIndexBuffer(groundIdxBuf, "uint32");
        pass.drawIndexed(6);

        // 3. Real Teapot
        pass.setPipeline(teapotPipeline);
        pass.setBindGroup(1, teapotBG_Real);
        pass.setVertexBuffer(0, teapotPosBuf); 
        pass.setVertexBuffer(1, teapotNorBuf);
        pass.setIndexBuffer(teapotIdxBuf, "uint32");
        pass.drawIndexed(teapotIndexCount);

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

async function loadBitmap(url) {
    const res = await fetch(url);
    const blob = await res.blob();
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
    const data = new Float32Array(60); 
    
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