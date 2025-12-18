struct Uniforms {
  mvp: mat4x4f,
  visibility: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var ourSampler: sampler;
@group(0) @binding(2) var ourTexture: texture_2d<f32>;

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
};

@vertex
fn main_vs(
  @location(0) inPos: vec4f,
  @location(1) texCoord: vec2f,
  @builtin(instance_index) instance: u32
) -> VSOut {
  var out: VSOut;
  out.position = uniforms.mvp * inPos;
  out.texCoord = texCoord;
  return out;
}

@fragment
fn main_fs(@location(0) texCoords: vec2f) -> @location(0) vec4f {
  let tex = textureSample(ourTexture, ourSampler, texCoords);
  let v = uniforms.visibility;
  return tex * vec4f(v, v, v, 1.0);
}
