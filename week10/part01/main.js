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
        emittedRadiance: parseFloat(emittedRadianceSlider.value),
        ambientRadiance: parseFloat(ambientRadianceSlider.value),
        diffuse: parseFloat(diffuseSlider.value),
        specular: parseFloat(specularSlider.value),
        shininess: parseFloat(shininessSlider.value),
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

    // CORRECTED PATH: ../assets/suzanne.obj
    const obj_filename = "../assets/suzanne.obj"; 
    const obj = await readOBJFile(obj_filename, 1.0, true);

    const positions = obj.vertices;
    const positionBuffer = device.createBuffer({
        size: sizeof['vec4'] * positions.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const positionBufferLayout = {
        arrayStride: sizeof['vec4'],
        attributes: [{
            format: 'float32x4',
            offset: 0,
            shaderLocation: 0,
        }],
    };
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

    const colors = obj.colors;
    const colorBuffer = device.createBuffer({
        size: sizeof['vec4'] * colors.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const colorBufferLayout = {
        arrayStride: sizeof['vec4'],
        attributes: [{
            format: 'float32x4',
            offset: 0,
            shaderLocation: 1,
        }],
    };
    device.queue.writeBuffer(colorBuffer, 0, flatten(colors));

    const normals = obj.normals;
    const normalBuffer = device.createBuffer({
        size: sizeof['vec4'] * normals.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const normalBufferLayout = {
        arrayStride: sizeof['vec4'],
        attributes: [{
            format: 'float32x4',
            offset: 0,
            shaderLocation: 2,
        }],
    };
    device.queue.writeBuffer(normalBuffer, 0, flatten(normals));

    const indices = obj.indices;
    const indicesBuffer = device.createBuffer({
        size: sizeof['vec4'] * indices.length,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indicesBuffer, 0, indices);

    const uniformBuffer = device.createBuffer({
        size: 4 * 8 + sizeof['mat4'],
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0) // Cornflower

    const Mst = mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    )

    const M = mult(translate(0, -0.5, 0), scalem(0.8, 0.8, 0.8));

    let projection = perspective(45, canvas.width / canvas.height, 0.1, 100);
    projection = mult(Mst, projection);

    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode
        = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({
        code: wgslcode
    });

    const msaaCount = 4;

    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [positionBufferLayout, colorBufferLayout, normalBufferLayout],
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

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: { buffer: uniformBuffer }
        }],
    });

    // Euler angle parameters
    let thetax = 0;
    let thetay = 0;
    let angularSpeed = 0.5;

    let x0 = 0;
    let y0 = 0;

    let isDragging = false;

    // Dispatch mouse events when using touch
    canvas.addEventListener("touchstart", function (event) {
        event.preventDefault();
        if (event.targetTouches.length === 1) {
            var touch = event.targetTouches[0];
            canvas.dispatchEvent(new MouseEvent("mousedown",
                {
                    button: 0, bubbles: true, cancelable: true,
                    clientX: touch.clientX, clientY: touch.clientY
                }));
            this.addEventListener("touchmove", roll, false);
            this.addEventListener("touchend", release, false);
            function roll(e) {
                touch = e.targetTouches[0];
                canvas.dispatchEvent(new MouseEvent("mousemove",
                    { bubbles: true, cancelable: true, clientX: touch.clientX, clientY: touch.clientY }));
            }
            function release() {
                canvas.dispatchEvent(new MouseEvent("mouseup",
                    { bubbles: true, cancelable: true, clientX: touch.clientX, clientY: touch.clientY }));
                this.removeEventListener("touchmove", roll);
                this.removeEventListener("touchend", release);
            }
        }
    });

    // Mouse event handlers
    canvas.addEventListener("mousedown", function (event) {
        // Prevent default to avoid selection, but calculate relative pos
        const rect = canvas.getBoundingClientRect();
        x0 = event.clientX - rect.left;
        y0 = event.clientY - rect.top;
        isDragging = true;
    });

    canvas.addEventListener("mousemove", function (event) {
        if (!isDragging) return;
        event.preventDefault();
        
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        const dx = x - x0;
        const dy = y - y0;
        
        thetax += dy * angularSpeed;
        thetay += dx * angularSpeed;
        
        x0 = x;
        y0 = y;

        requestAnimationFrame(render);
    });

    canvas.addEventListener("mouseup", function (event) {
        isDragging = false;
    });
    
    canvas.addEventListener("mouseleave", function(event) {
        isDragging = false;
    });


    function render() {
        const {
            emittedRadiance,
            ambientRadiance,
            diffuse,
            specular,
            shininess
        } = getOptions();

        const r = 4;
        let eye = vec4(0, 0, r, 1);

        let Rx = rotateX(thetax);
        let Ry = rotateY(thetay);
        
        // Orbiting: Rotate the eye position around the center
        eye = mult(Rx, mult(Ry, eye));

        const V = lookAt(vec3(eye[0], eye[1], eye[2]), vec3(0, 0, 0), vec3(0, 1, 0));
        const mvp = mult(projection, mult(V, M));

        const uniformFloats = new Float32Array([
            ...flatten(vec3(eye[0], eye[1], eye[2])), // eye pos
            emittedRadiance,
            ambientRadiance,
            diffuse,
            specular,
            shininess,
        ]);
        device.queue.writeBuffer(uniformBuffer, 0, uniformFloats);
        device.queue.writeBuffer(uniformBuffer, 4 * 8, flatten(mvp));

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
        pass.setVertexBuffer(1, colorBuffer);
        pass.setVertexBuffer(2, normalBuffer);
        pass.setBindGroup(0, bindGroup);
        pass.drawIndexed(indices.length);

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    setupInputListeners(() => { requestAnimationFrame(render); });
    render();
}

window.onload = function () { main(); }