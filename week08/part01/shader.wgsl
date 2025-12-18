struct Uniforms {
    // Model-View-Projection matrix:
    // takes positions from object space all the way to clip space
    mvp: mat4x4f,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

@group(0) @binding(1)
var ourSampler: sampler; 
// Sampler describes HOW we sample the texture:
// wrapping (repeat/clamp), filtering (nearest/linear), mipmap filtering, etc.

@group(0) @binding(2)
var ourTexture: texture_2d<f32>;
// 2D texture storing RGBA color values in float form (sampled via ourSampler)

struct VSOut {
    // Clip-space position consumed by the rasterizer
    @builtin(position) position: vec4f,

    // Interpolated UV that will be passed to the fragment shader
    @location(0) texCoord: vec2f,
}

@vertex
fn main_vs(
    // Per-vertex position (typically vec4 = xyz + 1)
    @location(0) inPos: vec4f,

    // Per-vertex texture coordinate (u,v)
    @location(1) texCoord: vec2f,

    // Instance id (not used here, but included so instancing can be added/kept)
    @builtin(instance_index) instance: u32
) -> VSOut {
    var vsOut: VSOut;

    // Transform vertex into clip space
    vsOut.position = uniforms.mvp * inPos;

    // Pass UV through (GPU will interpolate it across the triangle)
    vsOut.texCoord = texCoord;

    return vsOut;
}

@fragment
fn main_fs(
    // Interpolated UV from the vertex shader (one per fragment/pixel)
    @location(0) texCoords: vec2f
) -> @location(0) vec4f {
    // Sample the texture at this UV using the chosen sampler state
    // (wrapping/filtering/mipmaps all happen inside textureSample)
    return textureSample(ourTexture, ourSampler, texCoords);
}
