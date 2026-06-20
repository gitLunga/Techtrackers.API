using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto
{
    public class FeedbackDto
    {
        public int Log_ID { get; set; }
        public int User_ID { get; set; }
        public int Rating { get; set; }
        public string? Comment { get; set; }
    }
}
