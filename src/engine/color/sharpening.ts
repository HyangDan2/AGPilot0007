// Two-band luminance sharpening; independent implementation with bounded halo gain.
export const SHARPENING_SHADER=`
uniform sampler2D u_graded;
uniform int u_detail_stage;
uniform vec4 u_detail; // amount/100, radius in source pixels, detail/100, masking/100
uniform vec2 u_source_size;
uniform bool u_detail_mask;
uniform bool u_detail_fast;
vec3 gradedAt(vec2 uv){return texture(u_graded,vec2(clamp(uv.x,0.,1.),1.-clamp(uv.y,0.,1.))).rgb;}
float detailLuma(vec2 uv){return dot(gradedAt(uv),vec3(.2126,.7152,.0722));}
vec3 sharpenColor(vec3 color){
 vec2 stepUV=vec2(u_detail.y)/u_source_size;
 float center=dot(color,vec3(.2126,.7152,.0722));
 float nearSum=0.,farSum=0.,low=center,high=center;
 for(int i=0;i<8;i++){
  if(u_detail_fast && i%2==1)continue;
  float angle=float(i)*.78539816339;vec2 d=vec2(cos(angle),sin(angle))*stepUV;
  float n=detailLuma(v_uv+d),f=detailLuma(v_uv+d*2.);
  nearSum+=n;farSum+=f;low=min(low,n);high=max(high,n);
 }
 float taps=u_detail_fast?4.:8.;
 float nearBlur=(nearSum+center*4.)/(taps+4.),farBlur=(farSum+nearSum+center*4.)/(taps*2.+4.);
 float edge=high-low;
 float threshold=u_detail.w*u_detail.w*.22;
 float mask=u_detail.w<=0.?1.:smoothstep(threshold,threshold+.025,edge);
 if(u_detail_mask)return vec3(mask);
 float fine=center-nearBlur,broad=nearBlur-farBlur;
 float boost=(fine*mix(.35,1.7,u_detail.z)+broad)*u_detail.x*mask;
 float bound=max(.005,edge*.35);boost=clamp(boost,-bound,bound);
 return color+vec3(boost);
}
`;
