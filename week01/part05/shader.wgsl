struct Uniforms {
  offset : vec4f,   // (x,y,z, _)
};

@group(0) @binding(0) var<uniform> U : Uniforms;

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec3f,
};

@vertex
fn main_vs(
  @location(0) inPos : vec2f,
  @location(1) inColor : vec3f
) -> VSOut {
  var out : VSOut;
  let p = vec2f(inPos.x + U.offset.x, inPos.y + U.offset.y);
  out.position = vec4f(p, 0.0, 1.0);
  out.color = inColor;
  return out;
}

@fragment
fn main_fs(@location(0) c : vec3f) -> @location(0) vec4f {
  return vec4f(c, 1.0);
}
