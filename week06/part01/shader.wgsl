struct Uniforms {
  mvp: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var ourSampler: sampler;
@group(0) @binding(2) var ourTexture: texture_2d<f32>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
};

@vertex
fn main_vs(
  @location(0) inPos: vec3<f32>,
  @location(1) inUV: vec2<f32>
) -> VSOut {
  var out: VSOut;
  out.position = uniforms.mvp * vec4<f32>(inPos, 1.0);
  out.texCoord = inUV;
  return out;
}

@fragment
fn main_fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(ourTexture, ourSampler, uv);
}
