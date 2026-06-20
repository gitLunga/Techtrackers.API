using Microsoft.AspNetCore.Http;
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto
{
    public class LogDto
    {

        public string? Issue_Title { get; set; }
        public int Category_ID { get; set; }
        public string? Department { get; set; }
        public string? Priority { get; set; }
        public string? Description { get; set; }
        public DateTime Created_at { get; set; }
        public string? Location { get; set; }
        public string? LogStatus { get; set; }
        public int Staff_ID { get; set; }
        public IFormFile? AttachmentFile { get; set; }

    }
}
